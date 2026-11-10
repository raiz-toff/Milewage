import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { describe } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { useApiQuery } from '../api/query';
import { formatDistance, formatMoney } from '../format';
import { useSettings } from '../session';
import { PERIODS, dateWords, dayOf, weekWords } from '../days';
import { Est } from '../ui/Est';

type Summary = Schemas['Summary'];
type Range = { from: string; to: string };

/** The selected period's summary, plus today and this week for the line under the figure. */
function useSummaries(chosen: Range, today: Range, week: Range) {
  const asked = [
    useApiQuery('/summary', { params: { query: chosen } }),
    useApiQuery('/summary', { params: { query: today } }),
    useApiQuery('/summary', { params: { query: week } }),
  ];
  const [summary, ofToday, ofWeek] = asked.map((q) => q.data);
  const failed = asked.find((q) => q.error);
  // Right after a tab change the new period has no answer yet; wait for it.
  return {
    data: summary && ofToday && ofWeek ? { summary, today: ofToday, week: ofWeek } : null,
    error: failed ? describe(failed.error) : null,
    retry: () => asked.forEach((q) => q.isError && void q.refetch()),
  };
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

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <Card size="sm" role="group" aria-label={label}>
      <CardContent className="space-y-0.5">
        {/* Three tiles share a phone's width: the figure steps down a size there, unbroken. */}
        <p className="text-title-medium font-medium whitespace-nowrap tabular-nums sm:text-title-large">
          {value}
        </p>
        <p className="text-body-small text-on-surface-variant">{label}</p>
        {note ? <p className="text-body-small text-on-surface-variant">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * One period: the big earnings figure, Comma's three tiles (time, distance, per hour) and the
 * deduction tip. Together they keep the three metrics of 05 section 4: hourly earnings, the
 * active and deadhead split (marked as an estimate) and the deduction value.
 */
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
  const unit = settings.distance_unit;
  const missing = missingEarnings(settings);
  const business = formatDistance(summary.active_m + summary.deadhead_m, unit);
  const split = settings.modules.stops && summary.active_m + summary.deadhead_m > 0;
  const perHourWhy =
    summary.hours === 0
      ? 'No shift time yet'
      : summary.earnings_cents !== null
        ? undefined
        : missing.value === 'Unavailable'
          ? 'Earnings are off'
          : 'No earnings entered';
  // The driver's own rate is always called theirs, never official (plan 21 Q5, J8, ADR 0007).
  const rate =
    summary.deduction_rate !== undefined ? summary.deduction_rate : settings.mileage_rate;
  const deduction =
    rate === 'yours'
      ? 'Deduction value (your rate)'
      : rate === 'mixed'
        ? 'Deduction value (country and your rate)'
        : 'Deduction value';
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
          <p className="text-label-medium text-on-surface-variant">Earned, after app fees</p>
          <p className="text-display-small font-medium tabular-nums sm:text-display-medium">
            {earned === null ? missing.value : money(earned)}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {earned === null ? missing.why : line}
          </p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Shift time" value={`${summary.hours.toFixed(1)} h`} />
        <Tile label="Business distance" value={business} />
        <Tile
          label="Per hour"
          value={
            summary.hourly_earnings_cents === null ? '—' : money(summary.hourly_earnings_cents)
          }
          note={perHourWhy}
        />
      </div>
      {split ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Of that, {formatDistance(summary.active_m, unit)} active
          <Est /> and {formatDistance(summary.deadhead_m, unit)} deadhead
          <Est />. * Estimated from detected stops.
        </p>
      ) : null}
      {summary.deduction_cents !== null && summary.deduction_cents > 0 ? (
        <Card size="sm" role="note" aria-label={deduction} className="bg-muted/40">
          <CardContent className="text-sm text-muted-foreground">
            Estimated {deduction.toLowerCase()}:{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {money(summary.deduction_cents)}
            </span>{' '}
            on {business} of business driving. It lowers your taxable income; it is not money paid
            to you.{' '}
            {settings.modules.tax ? (
              <Link to="/tax" className="font-medium text-foreground underline underline-offset-4">
                Open Tax
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The dashboard hero (Comma's Today / Week card, 18 section 13): earnings after app fees for the
 * chosen period, then time, business distance and earnings per hour. The longer periods the
 * dashboard had before stay as further tabs.
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
  const day = dayOf(now, settings.timezone);
  const rangeOf = (id: string) => PERIODS.find((p) => p.id === id)!.range(day, settings.week_start);
  const chosen = rangeOf(period);
  const today = rangeOf('today');
  const week = rangeOf('week');
  const { data, error, retry } = useSummaries(chosen, today, week);
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
        ) : !data ? (
          <div className="grid grid-cols-3 gap-3" aria-busy="true">
            <Skeleton className="col-span-3 h-36 rounded-xl" />
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <PeriodFigures
            summary={data.summary}
            today={data.today}
            week={data.week}
            periodId={period}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
