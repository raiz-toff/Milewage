import { useState } from 'react';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  dateLocale,
  dateToIso,
  formatMonth,
  isoToDate,
  period,
  periodOffset,
  rangeText,
  todayIn,
} from '../days';
import type { PeriodKind } from '../days';
import { SegmentedButtons } from '../ui/chips';
import { moneyText, PageHeader, Section } from '../ui/layout';
import type { MoneyTone } from '../ui/layout';
import { describe } from '../api/client';
import { useApiQuery } from '../api/query';
import { deductionWord, formatDistance, formatMoney, fromMetres } from '../format';
import { useSettings } from '../session';
import { FormError } from '../ui/form';
import { usePlatformOf } from '../platforms/usePlatforms';
import { businessOf, comparedWith, usePlatformColors, useSeries } from '../series';
import { Comparison } from '../ui/Comparison';
import { ChartEmpty, ChartSkeleton } from '../ui/charts';
import {
  ChartSection,
  DistanceOverTime,
  EarningsOverTime,
  MoneyInOut,
  PayRates,
  PlatformTable,
  RunningTotal,
  VehicleTable,
  WhenItPays,
} from './AnalyticsCharts';
import type { Ctx } from './AnalyticsCharts';

type Mode = PeriodKind;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;

/**
 * Analytics (module `analytics`, 18 section 10.1): a period navigator, the period's figures, then
 * one chart per question (how the money came in, the pace against the period before, pay per hour
 * and per mile, where the distance went, when it pays, money in and out) and the platforms and
 * vehicles side by side. Every chart has its table.
 */
export function AnalyticsPage() {
  const settings = useSettings();
  const {
    timezone,
    currency,
    country,
    week_start: weekStart,
    time_format: timeFormat,
    distance_unit: unit,
    modules,
  } = settings;
  const platformOf = usePlatformOf();
  const colorOf = usePlatformColors();
  const [mode, setMode] = useState<Mode>('week');
  const [offset, setOffset] = useState(0);
  const today = todayIn(timezone);
  const range = period(mode, today, weekStart, offset);
  const before = period(mode, today, weekStart, offset - 1);
  const [picking, setPicking] = useState(false);
  const periodText = rangeText(range.from, range.to, dateLocale(country));
  const money = (c: number | null | undefined) =>
    c == null ? 'not available' : formatMoney(c, currency);
  const bucket = mode === 'year' ? ('month' as const) : ('day' as const);

  // Every group of the period shown, in one request.
  const groups = useApiQuery('/analytics', {
    params: { query: { from: range.from, to: range.to, group: 'all' } },
  });
  const data = (groups.data?.data as Data | undefined) ?? null;
  const series = useSeries(range, bucket);
  const previous = useSeries(before, bucket);
  const breakdown = useApiQuery('/analytics/breakdown', {
    params: { query: { from: range.from, to: range.to } },
  });
  // The comparison under the figure: up to the same point when the period is still running.
  const compared = comparedWith(mode, range, today);
  const nowSummary = useApiQuery('/summary', { params: { query: compared.current } });
  const prevSummary = useApiQuery('/summary', { params: { query: compared.previous } });
  const wholeSummary = useApiQuery('/summary', { params: { query: range } });
  const vehicles = useApiQuery('/vehicles').data ?? [];
  const categories =
    useApiQuery('/expenses/categories', undefined, { enabled: modules.expenses }).data ?? [];
  const failed = [groups, series, previous, breakdown].find((q) => q.error)?.error;
  const error = failed ? describe(failed) : null;

  const cards = data?.cards as Data | undefined;
  const whole = wholeSummary.data;
  const business = whole ? businessOf(whole) : 0;
  // Money in and out carry the earned and spent colours (the label says which); the net by its sign.
  const inOut = (cents: number | null | undefined, tone: MoneyTone) =>
    cents ? (cents < 0 ? 'spent' : tone) : undefined;
  const perDistance =
    cards?.gross_cents != null && business > 0
      ? money(Math.round(cards.gross_cents / fromMetres(business, unit)))
      : 'not available';
  const tiles: [string, string | null, MoneyTone?][] = cards
    ? [
        ['Earned, after app fees', money(cards.gross_cents), inOut(cards.gross_cents, 'earned')],
        ...(cards.expenses_cents === undefined
          ? []
          : ([
              [
                'Spent',
                money(cards.spent_cents ?? cards.expenses_cents),
                inOut(cards.spent_cents ?? cards.expenses_cents, 'spent'),
              ],
              ['Deductible expenses', money(cards.expenses_cents)],
              [
                'Burn ratio',
                cards.burn_ratio == null
                  ? 'not available'
                  : `${(cards.burn_ratio * 100).toFixed(1)}%`,
              ],
              [
                'Net take-home',
                money(cards.net_take_home_cents),
                inOut(cards.net_take_home_cents, 'earned'),
              ],
            ] as [string, string, MoneyTone?][])),
        ...(cards.tax_set_aside_cents === undefined
          ? []
          : ([['Tax set-aside', money(cards.tax_set_aside_cents)]] as [string, string][])),
        ['Per hour (shift time)', money(cards.hourly_shift_cents)],
        // Online time is typed per platform on the phone; without it there is no such figure.
        ...(cards.hourly_online_cents == null
          ? []
          : ([['Per hour (online time)', money(cards.hourly_online_cents)]] as [string, string][])),
        [unit === 'mi' ? 'Per mile (business)' : 'Per km (business)', perDistance],
        ['Total time', `${cards.total_hours} h`],
      ]
    : [];
  const when =
    mode === 'week'
      ? offset === 0
        ? 'this week'
        : 'that week'
      : mode === 'month'
        ? formatMonth(range.from, dateLocale(country))
        : range.from.slice(0, 4);
  const ctx: Ctx = { currency, unit, timeFormat, weekStart, today, bucket, when };
  const buckets = series.data?.buckets ?? [];
  const nothing =
    series.data !== undefined && buckets.every((b) => b.shift_count === 0 && !b.earnings_cents);
  const earningsPossible = modules.earnings || modules.stops;
  const vehicleName = (id: number | null) =>
    vehicles.find((v) => v.id === id)?.name ?? (id === null ? 'No vehicle' : `Vehicle ${id}`);
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug;
  const deduction = whole?.deduction_cents ? (
    <p className="text-body-medium text-on-surface-variant">
      Estimated {deductionWord({ ...settings, deduction_rate: whole.deduction_rate })} value:{' '}
      <span className="font-medium text-on-surface tabular-nums">
        {money(whole.deduction_cents)}
      </span>{' '}
      on {formatDistance(business, unit)} of business driving. It lowers your taxable income; it is
      not money paid to you.
    </p>
  ) : null;

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
            <div className="mt-1 text-body-small text-muted-foreground">
              earned after app fees · {cards.total_hours} h
            </div>
          ) : null}
          {cards?.gross_cents != null && nowSummary.data && prevSummary.data ? (
            <Comparison
              className="mt-1 justify-center text-center"
              current={nowSummary.data.earnings_cents}
              previous={
                prevSummary.data.earnings_cents ?? (prevSummary.data.shift_count === 0 ? 0 : null)
              }
              format={(v) => formatMoney(v, currency)}
              words={compared.words}
            />
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
        <p className="text-body-medium text-muted-foreground">Loading</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Figures">
            {tiles.map(([k, v, tone]) => (
              <div key={k} className="space-y-1 rounded-medium bg-card p-4">
                <dt className="text-label-medium text-muted-foreground">{k}</dt>
                <dd
                  className={cn(
                    'text-title-large font-medium tabular-nums',
                    tone && moneyText[tone],
                  )}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {!series.data || !breakdown.data ? (
            <Section label="Charts">
              <ChartSkeleton />
            </Section>
          ) : nothing ? (
            <ChartEmpty>
              No shifts in {when} yet. Start one on your phone, or pick another period with the
              arrows.
            </ChartEmpty>
          ) : (
            <>
              {earningsPossible && buckets.some((b) => b.earnings_cents) ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartSection
                    title="Earnings"
                    description={`What came in each ${bucket}, after app fees, and from where.`}
                  >
                    <EarningsOverTime
                      ctx={ctx}
                      buckets={buckets}
                      platformOf={platformOf}
                      colorOf={colorOf}
                      byPlatform={modules.platforms}
                    />
                  </ChartSection>
                  <ChartSection
                    title="Pace"
                    description="Earnings added up through the period, against the period before."
                  >
                    <RunningTotal
                      ctx={ctx}
                      current={buckets}
                      previous={previous.data?.buckets ?? []}
                    />
                  </ChartSection>
                </div>
              ) : null}
              {earningsPossible && buckets.some((b) => b.earnings_cents) ? (
                <ChartSection
                  title="Pay rate"
                  description={`What each ${bucket} worked paid for the time and for the distance.`}
                >
                  <PayRates ctx={ctx} buckets={buckets} />
                </ChartSection>
              ) : null}
              {buckets.some((b) => b.total_m > 0) ? (
                <ChartSection
                  title="Distance"
                  description={`Where the ${unit === 'mi' ? 'miles' : 'kilometres'} went each ${bucket}.`}
                >
                  <DistanceOverTime ctx={ctx} buckets={buckets} />
                </ChartSection>
              ) : null}
              {breakdown.data.week_hours.length > 0 ? (
                <ChartSection
                  title="When it pays"
                  description="Each weekday and time of day, from the shifts in this period."
                >
                  <WhenItPays
                    ctx={ctx}
                    cells={breakdown.data.week_hours}
                    earnings={
                      earningsPossible && breakdown.data.week_hours.some((c) => c.earnings_cents)
                    }
                  />
                </ChartSection>
              ) : null}
              {modules.expenses && cards?.expenses_cents !== undefined ? (
                <ChartSection
                  title="Money in and out"
                  description="Earnings against what you paid out, and where it went."
                >
                  <MoneyInOut
                    ctx={ctx}
                    earnedCents={cards?.gross_cents ?? null}
                    deductibleCents={cards?.expenses_cents ?? 0}
                    categories={breakdown.data.expense_categories ?? []}
                    categoryName={categoryName}
                    deduction={deduction}
                  />
                </ChartSection>
              ) : deduction ? (
                <Section label="Deduction" title="Deduction">
                  {deduction}
                </Section>
              ) : null}
              {modules.platforms && breakdown.data.platforms.length > 0 ? (
                <ChartSection
                  title="Platforms"
                  description="Each platform side by side, with its earnings across the period."
                >
                  <PlatformTable
                    ctx={ctx}
                    platforms={breakdown.data.platforms}
                    buckets={buckets}
                    platformOf={platformOf}
                  />
                </ChartSection>
              ) : null}
              {breakdown.data.vehicles.length > 1 ? (
                <ChartSection
                  title="Vehicles"
                  description="Each vehicle side by side: time, distance and what it earned."
                >
                  <VehicleTable ctx={ctx} vehicles={breakdown.data.vehicles} nameOf={vehicleName} />
                </ChartSection>
              ) : null}
            </>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <Section label="Outlook" title="Outlook" className="text-body-medium">
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
            <Section label="Efficiency" title="Efficiency" className="text-body-medium">
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
            <Section label="Work rhythm" title="Work rhythm" className="text-body-medium">
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
        </>
      )}
    </section>
  );
}
