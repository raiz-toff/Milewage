import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { PERIODS } from './Dashboard';
import { dateWords, weekWords } from './Shifts';

type Summary = Schemas['Summary'];
type Range = { from: string; to: string };

/** The selected period's summary, plus today and this week for the line under the figure. */
function useSummaries(ranges: Range[]) {
  const { api } = useSession();
  const [data, setData] = useState<Map<string, Summary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const keys = [...new Set(ranges.map((r) => `${r.from}/${r.to}`))];
  const key = keys.join(',');
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    void Promise.all(
      key.split(',').map(async (k) => {
        const [from, to] = k.split('/') as [string, string];
        return [k, await unwrap(api.GET('/summary', { params: { query: { from, to } } }))] as const;
      }),
    )
      .then((rows) => live && setData(new Map(rows)))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, key, attempt]);
  const get = (r: Range) => data?.get(`${r.from}/${r.to}`) ?? null;
  // Right after a tab change the old answers are still held; wait for the new period's.
  const ready = data !== null && keys.every((k) => data.has(k));
  return { get, ready, error, retry: () => setAttempt((n) => n + 1) };
}

/** Comma's Today and Week first, then the longer periods the dashboard had before. */
const TABS = ['today', 'week', 'month', 'year', '30d'];

const count = (n: number) => `${n} ${n === 1 ? 'shift' : 'shifts'}`;

/** Why there is no earnings figure: nothing typed or labelled, or no way to enter it here. */
function missingEarnings(s: Settings): { value: string; why: string } {
  if (s.modules.earnings)
    return { value: 'Not entered', why: 'Enter what the apps paid on a shift to see it here.' };
  if (s.modules.stops)
    return { value: 'Not entered', why: 'Label your stops to see what you earned.' };
  return { value: 'Unavailable', why: 'Earnings are switched off on this server.' };
}

/** The big earnings figure for one period, with today or this week on the line under it. */
function PeriodFigures({
  summary,
  today,
  week,
  periodId,
}: {
  summary: Summary;
  today: Summary;
  week: Summary;
  periodId: string;
}) {
  const settings = useSettings();
  const money = (c: number) => formatMoney(c, settings.currency);
  const missing = missingEarnings(settings);
  // With no shift there is nothing to enter, so the honest figure is zero, not "not entered".
  const earned = summary.earnings_cents ?? (summary.shift_count === 0 ? 0 : null);
  const earnedOf = (s: Summary) => money(s.earnings_cents ?? 0);
  const line =
    periodId === 'today'
      ? `${earnedOf(week)} this week · ${count(week.shift_count)} this week`
      : periodId === 'week'
        ? `${earnedOf(today)} today · ${count(week.shift_count)} this week`
        : count(summary.shift_count);
  return (
    <div className="space-y-3">
      <Card role="region" aria-label="Earned">
        <CardContent className="space-y-2 py-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Earned, after app fees
          </p>
          <p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {earned === null ? missing.value : money(earned)}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {earned === null ? missing.why : line}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The dashboard hero (Comma's Today / Week card, 18 section 13): earnings after app fees for the
 * chosen period. The longer periods the dashboard had before stay as further tabs.
 */
export function DashboardHero({
  now,
  period,
  onPeriod,
}: {
  now: number;
  period: string;
  onPeriod: (id: string) => void;
}) {
  const settings = useSettings();
  const rangeOf = (id: string) =>
    PERIODS.find((p) => p.id === id)!.range(now, settings.timezone, settings.week_start);
  const chosen = rangeOf(period);
  const today = rangeOf('today');
  const week = rangeOf('week');
  const { get, ready, error, retry } = useSummaries([chosen, today, week]);
  const words =
    chosen.from === chosen.to
      ? dateWords(chosen.from, { weekday: 'long', month: 'short', day: 'numeric' })
      : weekWords(chosen.from, chosen.to);

  return (
    <Tabs value={period} onValueChange={onPeriod} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <TabsList aria-label="Period">
          {TABS.map((id) => PERIODS.find((p) => p.id === id)!).map((p) => (
            <TabsTrigger key={p.id} value={p.id} className="px-2.5">
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="text-sm text-muted-foreground tabular-nums">{words}</p>
      </div>
      <TabsContent value={period}>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-destructive">{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : !ready ? (
          <Skeleton className="h-36 rounded-xl" aria-busy="true" />
        ) : (
          <PeriodFigures
            summary={get(chosen)!}
            today={get(today)!}
            week={get(week)!}
            periodId={period}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
