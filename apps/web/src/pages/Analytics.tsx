import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { dateLocale, dateToIso, isoToDate } from '../dateText';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { HourBars } from '../ui/HourBars';
import { describe, unwrap } from '../api/client';
import { apiKey } from '../api/query';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';
import { PlatformName } from '../platforms/PlatformBadge';
import { usePlatformOf } from '../platforms/usePlatforms';
import { localDate } from './Dashboard';

type Mode = 'week' | 'month' | 'year';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The local dates of the week, month or year `offset` periods from the one containing `today`. */
export function rangeOf(mode: Mode, offset: number, today: string, weekStart: number) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (mode === 'week') {
    const start = t - ((new Date(t).getUTCDay() - weekStart + 7) % 7) * DAY + offset * 7 * DAY;
    return { from: iso(start), to: iso(start + 6 * DAY) };
  }
  if (mode === 'month') {
    return { from: iso(Date.UTC(y, m - 1 + offset, 1)), to: iso(Date.UTC(y, m + offset, 0)) };
  }
  return { from: `${y + offset}-01-01`, to: `${y + offset}-12-31` };
}

/** How many periods from the one containing `today` to the one containing `day` (≤ 0 in the past). */
export function offsetOf(mode: Mode, day: string, today: string, weekStart: number): number {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  if (mode === 'year') return y - ty;
  if (mode === 'month') return (y - ty) * 12 + (m - tm);
  const start = (d: string) => Date.parse(rangeOf('week', 0, d, weekStart).from);
  return Math.round((start(day) - start(today)) / (7 * DAY));
}

/** "Nov 2 – 8, 2026" in the driver's country's order (Intl formatRange). */
export function rangeText(from: string, to: string, locale: string): string {
  const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).formatRange(
    at(from),
    at(to),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const GROUPS = [
  'cards',
  'trends',
  'sources',
  'rhythm',
  'outlook',
  'efficiency',
  'order_economics',
] as const;

/** Analytics (module `analytics`, 18 section 10.1): a period navigator and the groups the server returns. */
export function AnalyticsPage() {
  const { api } = useSession();
  const {
    timezone,
    currency,
    country,
    week_start: weekStart,
    time_format: timeFormat,
  } = useSettings();
  const platformOf = usePlatformOf();
  const [mode, setMode] = useState<Mode>('week');
  const [offset, setOffset] = useState(0);
  const today = localDate(Date.now(), timezone);
  const range = rangeOf(mode, offset, today, weekStart);
  const [picking, setPicking] = useState(false);
  const period = rangeText(range.from, range.to, dateLocale(country));
  const money = (c: number | null | undefined) =>
    c == null ? 'not available' : formatMoney(c, currency);

  // One request per group, all for the period shown; the page waits for every one.
  const groups = useQueries({
    queries: GROUPS.map((group) => {
      const params = {
        query: {
          from: range.from,
          to: range.to,
          group,
          ...(group === 'trends'
            ? { bucket: mode === 'year' ? ('month' as const) : ('day' as const) }
            : {}),
        },
      };
      return {
        queryKey: apiKey('/analytics', params),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          unwrap(api.GET('/analytics', { params, signal })).then((r) => r.data as unknown),
      };
    }),
  });
  const data: Data | null = groups.every((q) => q.isSuccess)
    ? Object.fromEntries(GROUPS.map((group, i) => [group, groups[i]!.data]))
    : null;
  const failed = groups.find((q) => q.error)?.error;
  const error = failed ? describe(failed) : null;

  const cards = data?.cards as Data | undefined;
  const tiles: [string, string | null][] = cards
    ? [
        ['Gross', money(cards.gross_cents)],
        ...(cards.expenses_cents === undefined
          ? []
          : ([
              ['Expenses', money(cards.expenses_cents)],
              [
                'Burn ratio',
                cards.burn_ratio == null
                  ? 'not available'
                  : `${(cards.burn_ratio * 100).toFixed(1)}%`,
              ],
              ['Net take-home', money(cards.net_take_home_cents)],
            ] as [string, string][])),
        ...(cards.tax_set_aside_cents === undefined
          ? []
          : ([['Tax set-aside', money(cards.tax_set_aside_cents)]] as [string, string][])),
        ['Per hour (shift time)', money(cards.hourly_shift_cents)],
        ['Per hour (online time)', money(cards.hourly_online_cents)],
        ['Total time', `${cards.total_hours} h`],
      ]
    : [];

  return (
    <section className="space-y-6">
      <PageHeader title="Analytics" description="Your figures for a week, a month or a year." />
      <FormError message={error} />
      <div className="inline-flex rounded-lg bg-muted p-1">
        {(['week', 'month', 'year'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${mode === m ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setMode(m);
              setOffset(0);
            }}
          >
            {m[0]!.toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      {/* The period header of the Shifts page (Comma's and Uber's earnings header): arrows at the
          edges, the period over the period's gross; the period opens a calendar. */}
      <div className="flex items-center justify-between gap-2">
        <UiButton
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous period"
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeft />
        </UiButton>
        <div className="flex min-w-0 flex-col items-center text-center">
          {/* The period as a shadcn Date Picker: any day picked opens the period that holds it. */}
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Period: ${period}`}
                className="font-normal text-muted-foreground tabular-nums"
              >
                <CalendarIcon />
                {period}
              </UiButton>
            </PopoverTrigger>
            <PopoverContent aria-label="Pick a period" align="center" className="w-auto p-0">
              <Calendar
                mode="single"
                captionLayout="dropdown"
                autoFocus
                defaultMonth={isoToDate(range.from)}
                startMonth={isoToDate(`${Number(today.slice(0, 4)) - 10}-01-01`)}
                endMonth={isoToDate(today)}
                today={isoToDate(today)}
                weekStartsOn={weekStart as 0 | 1}
                disabled={{ after: isoToDate(today)! }}
                modifiers={{
                  range_start: isoToDate(range.from)!,
                  range_middle: { after: isoToDate(range.from)!, before: isoToDate(range.to)! },
                  range_end: isoToDate(range.to)!,
                }}
                onSelect={(d) => {
                  if (d) setOffset(offsetOf(mode, dateToIso(d), today, weekStart));
                  setPicking(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <div
            aria-live="polite"
            className="truncate text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl"
          >
            {cards ? money(cards.gross_cents) : <Skeleton className="mx-auto mt-1 h-10 w-40" />}
          </div>
          {cards ? (
            <div className="mt-1 text-xs text-muted-foreground">gross · {cards.total_hours} h</div>
          ) : null}
        </div>
        <UiButton
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next period"
          disabled={offset >= 0}
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight />
        </UiButton>
      </div>
      {data === null ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Figures">
            {tiles.map(([k, v]) => (
              <div key={k} className="space-y-1 rounded-xl border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-xl font-semibold tracking-tight tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <Section label="Trends" title="Trends">
            {data.trends.buckets.length === 0 ? (
              <EmptyState>No shifts in this period.</EmptyState>
            ) : (
              <TableBox>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Shifts</th>
                      <th>Hours</th>
                      <th>Earnings</th>
                      <th>Per hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trends.buckets.map((b: Data) => (
                      <tr key={b.start} className="border-t border-border">
                        <td className="tabular-nums">{b.start}</td>
                        <td>{b.shifts}</td>
                        <td>{b.hours}</td>
                        <td>{money(b.earnings_cents)}</td>
                        <td>{money(b.hourly_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableBox>
            )}
            <p className="text-sm text-muted-foreground">
              Previous period: {money(data.trends.previous.earnings_cents)},{' '}
              {data.trends.previous.hours} h
            </p>
          </Section>
          {data.sources.length > 0 ? (
            <Section label="Income sources" title="Income sources">
              <ul className="space-y-3 text-sm">
                {data.sources.map((s: Data) => (
                  <li key={s.platform} className="space-y-1.5">
                    <PlatformName platform={platformOf(s.platform)} className="tabular-nums">
                      {platformOf(s.platform).label}: {money(s.earnings_cents)} (
                      {Math.round((s.share ?? 0) * 100)}%)
                    </PlatformName>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${Math.round((s.share ?? 0) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <Section label="Outlook" title="Outlook" className="text-sm">
              {data.outlook.projected_earnings_cents === null ? (
                <p className="text-muted-foreground">
                  Not enough shifts to project ({data.outlook.note}).
                </p>
              ) : (
                <p>
                  At this pace the period ends near {money(data.outlook.projected_earnings_cents)},{' '}
                  {data.outlook.days_left} days left. A projection, not a promise.
                </p>
              )}
            </Section>
            <Section label="Efficiency" title="Efficiency" className="text-sm">
              {data.efficiency.active_share === null ? (
                <p className="text-muted-foreground">No stop-based split for these shifts.</p>
              ) : (
                <p>
                  Active {Math.round(data.efficiency.active_share * 100)}% and deadhead{' '}
                  {Math.round(data.efficiency.deadhead_share * 100)}% (estimated from detected
                  stops).
                </p>
              )}
              {data.order_economics ? (
                <p>
                  {data.order_economics.orders} orders,{' '}
                  {money(data.order_economics.pay_per_order_cents)} each,{' '}
                  {data.order_economics.orders_per_hour} per hour.
                </p>
              ) : null}
            </Section>
            <Section label="Work rhythm" title="Work rhythm" className="text-sm">
              <p>
                Average shift:{' '}
                {data.rhythm.average_shift_minutes === null
                  ? 'not available'
                  : `${data.rhythm.average_shift_minutes} min`}
                . Busiest weekday:{' '}
                {(() => {
                  const best = [...data.rhythm.by_weekday].sort(
                    (a: Data, b: Data) => b.shifts - a.shifts,
                  )[0];
                  return best && best.shifts > 0
                    ? [
                        'Sunday',
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                      ][best.weekday]
                    : 'not available';
                })()}
                .
              </p>
            </Section>
          </div>
          <Section
            label="Shift start times"
            title="Shift start times"
            description="How many shifts started in each hour of the day, in this period."
          >
            <HourBars
              label="Shifts by start hour"
              unit={['shift', 'shifts']}
              bars={(data.rhythm.by_start_hour as Data[]).map((h) => ({
                hour: h.hour as number,
                value: h.shifts as number,
              }))}
              timeFormat={timeFormat}
              emptyText="No shifts started in this period."
            />
          </Section>
        </>
      )}
    </section>
  );
}
