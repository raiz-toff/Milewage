import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  dateLocale,
  dateToIso,
  isoToDate,
  period,
  periodOffset,
  rangeText,
  todayIn,
} from '../days';
import type { PeriodKind } from '../days';
import { SegmentedButtons } from '../ui/chips';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { HourBars } from '../ui/HourBars';
import { describe, unwrap } from '../api/client';
import { apiKey } from '../api/query';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';
import { PlatformName } from '../platforms/PlatformBadge';
import { usePlatformOf } from '../platforms/usePlatforms';

type Mode = PeriodKind;

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
  const today = todayIn(timezone);
  const range = period(mode, today, weekStart, offset);
  const [picking, setPicking] = useState(false);
  const periodText = rangeText(range.from, range.to, dateLocale(country));
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
      <SegmentedButtons
        label="Period"
        value={mode}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
        onChange={(m) => {
          setMode(m);
          setOffset(0);
        }}
      />
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
          <ChevronLeftIcon />
        </UiButton>
        <div className="flex min-w-0 flex-col items-center text-center">
          {/* The period as a shadcn Date Picker: any day picked opens the period that holds it. */}
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Period: ${periodText}`}
                className="font-normal text-muted-foreground tabular-nums"
              >
                <CalendarIcon />
                {periodText}
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
                  if (d) setOffset(periodOffset(mode, dateToIso(d), today, weekStart));
                  setPicking(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <div
            aria-live="polite"
            className="truncate text-display-small font-medium tabular-nums sm:text-display-medium"
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
          <ChevronRightIcon />
        </UiButton>
      </div>
      {data === null ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Figures">
            {tiles.map(([k, v]) => (
              <div key={k} className="space-y-1 rounded-medium bg-card p-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-title-large font-medium tabular-nums">{v}</dd>
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
                        <td className="whitespace-nowrap tabular-nums">{b.start}</td>
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
                    <div className="h-2 overflow-hidden rounded-full bg-secondary-container">
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
