import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, PageHeader, Section, StatCard } from '../ui/layout';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { useApiQuery } from '../api/query';
import { deductionWord, formatDistance, formatDuration, formatMoney, formatTime } from '../format';
import { RouteView } from '../map/RouteView';
import { PlatformBadge, PlatformName } from '../platforms/PlatformBadge';
import { usePlatformOf } from '../platforms/usePlatforms';
import {
  addDays,
  dateLocale,
  dateToIso,
  dateWords,
  isoToDate,
  rangeText,
  todayIn,
  weekOf,
  weekWords,
} from '../days';
import { useSeries } from '../series';
import { useSession, useSettings } from '../session';
import { useShiftRecord } from '../shift/record';
import { earnedOf, reviewCount, showsSplit } from '../shift/view';
import type { Picked } from '../shift/view';
import { FormError } from '../ui/form';
import { ExportButtons } from './Exports';
import { AddTrip, DeleteTripDialog } from './AddTrip';
import { useSeen } from './DashboardShifts';
import { ShiftCosts, useShiftCosts } from './ShiftCosts';
import { ShiftEarnings } from './ShiftEarnings';
import { ShiftChecks, ShiftFigures } from './ShiftFacts';
import { ShiftOdometer } from './ShiftOdometer';
import { InProgressCard, NoRouteCard, ShiftNotes } from './ShiftStates';
import { Est } from '../ui/Est';
import { MoreCard } from '../ui/MoreCard';
import { ShiftTimeline } from './ShiftTimeline';
import { StopsPanel } from './Stops';

type Shift = Schemas['Shift'];

const isDate = (d: string | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

type Summary = Schemas['Summary'];
interface DayBucket {
  /** The day, or the month (`YYYY-MM`) of a long range. */
  start: string;
  earnings_cents: number | null;
}
interface WeekData {
  shifts: Shift[];
  summary: Summary;
  /** Earnings per day, or per month for a long range. */
  buckets: DayBucket[];
}

/**
 * Everything the list needs for a range: its shifts (all pages), its summary, and the earnings per
 * day, or per month for a long range.
 */
function useWeek(from: string, to: string, bucket: 'day' | 'month') {
  const { api } = useSession();
  // Every page of the week, so its own key: one page of /shifts is a different answer.
  const shifts = useQuery({
    queryKey: ['/shifts', { query: { from, to } }, 'all pages'],
    queryFn: async ({ signal }) => {
      const out: Shift[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          api.GET('/shifts', {
            params: { query: { from, to, limit: 200, ...(cursor ? { cursor } : {}) } },
            signal,
          }),
        );
        out.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return out;
    },
  });
  const summary = useApiQuery('/summary', { params: { query: { from, to } } });
  const series = useSeries({ from, to }, bucket);
  // A slot with no shift and nothing earned has no earnings to show ("not entered"), not 0.
  const buckets = series.data?.buckets.map((b): DayBucket => ({
    start: bucket === 'month' ? b.start.slice(0, 7) : b.start,
    earnings_cents: b.shift_count === 0 && b.platforms.length === 0 ? null : b.earnings_cents,
  }));
  const failed = [shifts, summary, series].find((q) => q.error);
  const data: WeekData | null =
    shifts.data && summary.data && buckets
      ? { shifts: shifts.data, summary: summary.data, buckets }
      : null;
  return { data, error: failed ? describe(failed.error) : null };
}

/** Earnings are "not entered" when nobody typed or labelled them, never zero (05 section 3.1a). */
const earnedWords = (cents: number | null, currency: string) =>
  cents === null ? 'not entered' : formatMoney(cents, currency);

function StatusBadge({ shift }: { shift: Shift }) {
  if (shift.status === 'active')
    return (
      <Badge variant="outline" className="gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        In progress
      </Badge>
    );
  if (shift.status === 'finalized') return <Badge variant="secondary">Reviewed</Badge>;
  return null;
}

/**
 * One shift in the list, as the Comma phone app's row: the platforms and the day with its times,
 * then hours and distance in words, the note; on the right what it earned, its tips and the
 * deduction. Earnings are read when the row comes into view, only with the module on.
 */
export function ShiftCard({ shift, settings }: { shift: Shift; settings: Settings }) {
  const unit = settings.distance_unit;
  const tz = settings.timezone;
  const tf = settings.time_format;
  const split = showsSplit(shift, settings);
  const review = reviewCount(shift);
  const platformOf = usePlatformOf();
  const [ref, seen] = useSeen<HTMLAnchorElement>();
  const earnings = useApiQuery(
    '/shifts/{ref}/earnings',
    { params: { path: { ref: String(shift.id) } } },
    { enabled: seen && settings.modules.earnings },
  ).data;
  const platforms = earnings?.effective.map((r) => r.platform) ?? [];
  const cents = earnings ? earnedOf(earnings) : null;
  const tips = earnings?.effective.reduce((t, r) => t + r.tips_cents, 0) ?? 0;
  const fact = 'font-medium text-on-surface';
  return (
    <Link
      ref={ref}
      to={`/shifts/${shift.id}`}
      className="relative flex items-center justify-between gap-4 rounded-medium bg-card p-4 state-layer focus-ring"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {platforms.length > 0 ? (
            <span className="flex shrink-0 -space-x-1">
              {platforms.map((slug) => (
                <PlatformBadge
                  key={slug}
                  platform={platformOf(slug)}
                  className="ring-2 ring-card"
                />
              ))}
            </span>
          ) : null}
          <time dateTime={shift.local_date} className="text-title-medium">
            {dateWords(shift.local_date, { weekday: 'short', month: 'short', day: 'numeric' })}
          </time>
          <span className="text-body-medium text-muted-foreground tabular-nums">
            {formatTime(shift.started_at, tz, tf)} –{' '}
            {shift.ended_at ? formatTime(shift.ended_at, tz, tf) : 'now'}
          </span>
          <StatusBadge shift={shift} />
          {review > 0 ? (
            <Badge variant="outline" className="border-primary/60">
              {review} to review
            </Badge>
          ) : null}
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-medium text-muted-foreground tabular-nums">
          <span>
            Time: <span className={fact}>{formatDuration(shift.started_at, shift.ended_at)}</span>
          </span>
          <span>
            Distance: <span className={fact}>{formatDistance(shift.total_m, unit)}</span>
          </span>
          {split ? (
            <span>
              {formatDistance(shift.active_m, unit)} active
              <Est />
            </span>
          ) : null}
        </p>
        {platforms.length > 0 ? (
          <p className="truncate text-body-small text-muted-foreground">
            {platforms.map((slug) => platformOf(slug).label).join(', ')}
          </p>
        ) : null}
        {shift.notes ? (
          <p className="truncate text-body-medium text-muted-foreground italic">“{shift.notes}”</p>
        ) : null}
      </div>
      <div className="shrink-0 space-y-0.5 text-right tabular-nums">
        {earnings ? (
          <div className="text-title-large font-medium">
            {cents === null ? (
              <span className="text-body-medium font-normal text-muted-foreground">
                Earnings not entered
              </span>
            ) : (
              formatMoney(cents, settings.currency)
            )}
          </div>
        ) : null}
        {tips > 0 ? (
          <div className="text-body-small text-muted-foreground">
            {formatMoney(tips, settings.currency)} tips
          </div>
        ) : null}
        {shift.deduction_cents !== null ? (
          <div className="text-body-small text-muted-foreground">
            {formatMoney(shift.deduction_cents, settings.currency)}{' '}
            {deductionWord({
              mileage_rate: settings.mileage_rate,
              deduction_rate: shift.deduction_rate,
            })}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

const DAY_MS = 86_400_000;
const daysIn = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

/**
 * The period's calendar, as Material's date range picker: pick the first day, then the last, and
 * confirm with OK; Cancel leaves the page as it was. One day alone opens its week with that day
 * chosen. A click after a whole range starts a new one, and a day before the start becomes the
 * start.
 */
function PeriodPicker({
  label,
  from,
  to,
  day,
  today,
  weekStart,
  onRange,
}: {
  label: string;
  from: string;
  to: string;
  /** The single day chosen in the range shown, if any. */
  day: string | null;
  today: string;
  weekStart: number;
  onRange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const locale = dateLocale(useSettings().country);
  const iso = (d: Date | undefined) => (d ? dateToIso(d) : null);
  const start = iso(draft?.from);
  const end = iso(draft?.to);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Opens on what the page shows now.
        if (o) setDraft({ from: isoToDate(day ?? from), to: isoToDate(day ?? to) });
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Pick dates: ${label}`}
          className="font-normal text-muted-foreground tabular-nums"
        >
          <CalendarIcon />
          {label}
        </UiButton>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Pick dates"
        align="center"
        className="w-auto p-0"
        // The panel takes the focus itself, so no ring lands on a button nobody chose.
        tabIndex={-1}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <p aria-live="polite" className="px-6 pt-4 text-title-small text-on-surface tabular-nums">
          {start === null
            ? 'Pick the first day'
            : end === null
              ? `${rangeText(start, start, locale)} – pick the last day`
              : rangeText(start, end, locale)}
        </p>
        <Calendar
          mode="range"
          captionLayout="dropdown"
          selected={draft}
          onSelect={(_, d) =>
            setDraft((r) =>
              !r?.from || r.to || d < r.from ? { from: d, to: undefined } : { from: r.from, to: d },
            )
          }
          defaultMonth={isoToDate(day ?? to)}
          startMonth={isoToDate(`${Number(today.slice(0, 4)) - 10}-01-01`)}
          endMonth={isoToDate(today)}
          today={isoToDate(today)}
          weekStartsOn={weekStart as 0 | 1}
          disabled={{ after: isoToDate(today)! }}
        />
        <div className="flex justify-end gap-2 px-3 pb-3">
          <UiButton type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </UiButton>
          <UiButton
            type="button"
            variant="ghost"
            disabled={start === null}
            onClick={() => {
              if (start !== null) onRange(start, end ?? start);
              setOpen(false);
            }}
          >
            OK
          </UiButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The shifts of a week, or of any range picked in the calendar (Comma's layout): the total, a bar
 * per day (per month for a range over 31 days), the figures, then the list.
 */
export function ShiftList() {
  const settings = useSettings();
  const unit = settings.distance_unit;
  const currency = settings.currency;
  const [params, setParams] = useSearchParams();
  const today = todayIn(settings.timezone);
  const thisWeek = weekOf(today, settings.week_start);
  const asked = params.get('week');
  const [askedFrom, askedTo] = [params.get('from'), params.get('to')];
  // A range picked in the calendar (`from` and `to`), or else a week.
  const custom = isDate(askedFrom) && isDate(askedTo) && askedFrom <= askedTo;
  const from = custom ? askedFrom : weekOf(isDate(asked) ? asked : today, settings.week_start);
  const to = custom ? askedTo : addDays(from, 6);
  const span = daysIn(from, to);
  const byMonth = span > 31;
  const { data, error } = useWeek(from, to, byMonth ? 'month' : 'day');
  // The bar picked (a day, or a month of a long range); one outside the range picks nothing.
  const [day, setDay] = useState<string | null>(null);

  const go = (week: string, pick: string | null = null) => {
    setDay(pick);
    setParams(week === thisWeek ? {} : { week });
  };
  const goRange = (a: string, b: string) => {
    setDay(null);
    setParams({ from: a, to: b });
  };
  const step = (n: number) =>
    custom ? goRange(addDays(from, n * span), addDays(to, n * span)) : go(addDays(from, n * 7));

  const shifts = [...(data?.shifts ?? [])].sort((a, b) => b.started_at - a.started_at);
  const earnedWeek = data?.summary.earnings_cents ?? null;
  // Bars show money when there is money; otherwise distance.
  const byMoney = earnedWeek !== null;
  const keys = byMonth
    ? [...new Set(Array.from({ length: span }, (_, i) => addDays(from, i).slice(0, 7)))]
    : Array.from({ length: span }, (_, i) => addDays(from, i));
  const days = keys.map((date) => {
    const own = shifts.filter((s) => s.local_date.startsWith(date));
    return {
      date,
      shifts: own,
      distance: own.reduce((t, s) => t + (s.total_m ?? 0), 0),
      earned: data?.buckets.find((b) => b.start === date)?.earnings_cents ?? null,
      // Under the bar; in words for a screen reader and the headline.
      tick: byMonth
        ? dateWords(`${date}-01`, { month: 'short' })
        : dateWords(date, span > 7 ? { day: 'numeric' } : { weekday: 'short' }),
      name: byMonth
        ? dateWords(`${date}-01`, { month: 'long', year: 'numeric' })
        : dateWords(date, { weekday: 'long', month: 'short', day: 'numeric' }),
    };
  });
  type Slot = (typeof days)[number];
  const barName = (d: Slot) =>
    !byMonth && span <= 7 ? dateWords(d.date, { weekday: 'long' }) : d.name;
  const valueOf = (d: Slot) => (byMoney ? (d.earned ?? 0) : d.distance);
  const words = (d: Slot) =>
    byMoney ? earnedWords(d.earned, currency) : formatDistance(d.distance, unit);
  const high = Math.max(0, ...days.map(valueOf));
  const picked = days.find((d) => d.date === day) ?? null;
  const listed = picked ? picked.shifts : shifts;
  const anySplit = listed.some((s) => showsSplit(s, settings));
  const weekDistance = days.reduce((t, d) => t + d.distance, 0);

  const hero = picked
    ? words(picked)
    : earnedWeek !== null
      ? formatMoney(earnedWeek, currency)
      : formatDistance(weekDistance, unit);
  const heroLabel = picked
    ? picked.name
    : custom
      ? rangeText(from, to, dateLocale(settings.country))
      : weekWords(from, to);
  const unitWord = custom ? 'period' : 'week';

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-headline-small text-on-surface md:text-headline-medium">Shifts</h1>
        {custom || from !== thisWeek ? (
          <UiButton variant="outline" size="sm" onClick={() => go(thisWeek)}>
            This week
          </UiButton>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <UiButton
          variant="ghost"
          size="icon"
          aria-label={`Previous ${unitWord}`}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </UiButton>
        <div className="min-w-0 text-center">
          <PeriodPicker
            label={heroLabel}
            from={from}
            to={to}
            day={picked && !byMonth ? picked.date : null}
            today={today}
            weekStart={settings.week_start}
            onRange={(a, b) => (a === b ? go(weekOf(a, settings.week_start), a) : goRange(a, b))}
          />
          <div
            aria-live="polite"
            className="truncate text-display-small font-medium tabular-nums sm:text-display-medium"
          >
            {data ? hero : <Skeleton className="mx-auto mt-1 h-10 w-40" />}
          </div>
          {data ? (
            <div className="mt-1 text-body-small text-muted-foreground">
              {byMoney || (!picked && earnedWeek !== null) ? 'earned' : 'driven'} ·{' '}
              {picked ? picked.shifts.length : data.summary.shift_count}{' '}
              {(picked ? picked.shifts.length : data.summary.shift_count) === 1
                ? 'shift'
                : 'shifts'}
            </div>
          ) : null}
        </div>
        <UiButton
          variant="ghost"
          size="icon"
          aria-label={`Next ${unitWord}`}
          disabled={custom ? to >= today : from >= thisWeek}
          onClick={() => step(1)}
        >
          <ChevronRightIcon />
        </UiButton>
      </div>

      <Card>
        <CardContent>
          <div
            className={cn(
              'relative flex h-40 items-stretch',
              days.length > 14 ? 'gap-0.5 sm:gap-1' : 'gap-2 sm:gap-3',
            )}
          >
            {high > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2">
                <div className="flex-1 border-t border-dashed" />
                <span className="text-label-small text-muted-foreground tabular-nums">
                  High {byMoney ? formatMoney(high, currency) : formatDistance(high, unit)}
                </span>
              </div>
            ) : null}
            {days.map((d, i) => {
              const selected = d.date === day;
              const value = valueOf(d);
              const pct = high > 0 ? (value / high) * 100 : 0;
              const dim = day !== null && !selected;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${barName(d)}: ${words(d)}`}
                  onClick={() => setDay(selected ? null : d.date)}
                  className="group flex flex-1 flex-col items-center gap-2 rounded-small pt-6 focus-ring"
                >
                  <div className="flex w-full flex-1 items-end justify-center">
                    <div
                      className={cn(
                        'w-full max-w-12 rounded-md transition-all',
                        value > 0 ? 'bg-chart-1' : 'bg-muted',
                        dim && 'opacity-35',
                        !dim && 'group-hover:opacity-90',
                      )}
                      style={{ height: `${value > 0 ? Math.max(pct, 6) : 3}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-label-medium',
                      selected || d.date === today ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {/* Many bars: a label on every fifth, so none run into each other. */}
                    {days.length <= 14 || i % 5 === 0 ? d.tick : '\u00a0'}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Hours" value={`${data.summary.hours.toFixed(1)} h`} />
          <StatCard
            label="Distance"
            value={formatDistance(data.summary.total_m, unit)}
            sub={
              settings.modules.stops && shifts.some((s) => showsSplit(s, settings)) ? (
                <>
                  {formatDistance(data.summary.active_m, unit)} active
                  <Est />
                </>
              ) : undefined
            }
          />
          <StatCard
            label={deductionWord(
              {
                mileage_rate: settings.mileage_rate,
                deduction_rate: data.summary.deduction_rate,
              },
              true,
            )}
            value={formatMoney(data.summary.deduction_cents, currency)}
          />
          <StatCard
            label="Hourly earnings"
            value={earnedWords(data.summary.hourly_earnings_cents, currency)}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-title-small text-muted-foreground">
          {picked
            ? byMonth
              ? `Shifts in ${picked.name}`
              : `Shifts on ${barName(picked)}`
            : `Shifts ${custom ? 'in this period' : 'this week'}`}
        </h2>
        <FormError message={error} />
        {!data && !error ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : data && listed.length === 0 ? (
          <EmptyState>
            {picked
              ? `No shifts ${byMonth ? 'in this month' : 'on this day'}.`
              : custom
                ? 'No shifts in this period.'
                : 'No shifts this week. Shifts start on the phone.'}
          </EmptyState>
        ) : (
          <ul aria-label="Shifts" className="space-y-3">
            {listed.map((s) => (
              <li key={s.id}>
                <ShiftCard shift={s} settings={settings} />
              </li>
            ))}
          </ul>
        )}
        {anySplit ? (
          <p className="text-body-small text-muted-foreground">* estimated from detected stops</p>
        ) : null}
      </div>
    </section>
  );
}

export function ShiftDetail() {
  const { ref } = useParams();
  const settings = useSettings();
  const record = useShiftRecord(ref ?? '');
  const { shift, view, trips, stops } = record;
  const [picked, setPicked] = useState<Picked>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Schemas['Trip'] | null>(null);
  const [deleting, setDeleting] = useState<Schemas['Trip'] | null>(null);
  const costs = useShiftCosts(shift?.id, settings.modules.expenses);

  if (record.error && !shift)
    return (
      <p role="alert" className="text-muted-foreground">
        {record.error}
      </p>
    );
  if (!shift || !view) return <p className="text-muted-foreground">Loading</p>;
  const notes = (bare?: boolean) => <ShiftNotes shift={shift} bare={bare} />;
  const exportButtons = <ExportButtons selection={{ shift_id: shift.id }} />;

  return (
    <section className="@container space-y-6">
      <UiButton asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={`/shifts?week=${weekOf(shift.local_date, settings.week_start)}`}>
          <ChevronLeftIcon />
          All shifts
        </Link>
      </UiButton>
      <PageHeader
        title={dateWords(shift.local_date, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
        description={
          <span className="tabular-nums">
            {view.context}
            {view.platforms.map((p) => (
              <span key={p.slug}>
                {' · '}
                <PlatformName platform={p} className="align-middle" />
              </span>
            ))}
          </span>
        }
      >
        <StatusBadge shift={shift} />
        {view.review > 0 ? (
          <Badge asChild variant="outline" className="border-primary/60">
            <a href="#checks">{view.review} to review</a>
          </Badge>
        ) : null}
      </PageHeader>

      <div className="space-y-2">
        <ShiftFigures
          shift={shift}
          settings={settings}
          split={view.split}
          earned={view.earned}
          est={<Est />}
        />
        {view.split ? (
          <p className="text-body-small text-muted-foreground">* estimated from detected stops</p>
        ) : null}
      </div>

      <div
        className={cn(
          'grid items-start gap-6',
          view.sideBySide && '@3xl:grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        <div className="min-w-0">
          {view.main === 'in-progress' ? (
            <InProgressCard earnings={settings.modules.earnings} />
          ) : view.main === 'nothing-recorded' ? (
            <div id="checks" className="scroll-mt-20">
              <NoRouteCard
                shift={shift}
                tracking={settings.modules.tracking}
                onAdd={() => setAdding(true)}
              />
            </div>
          ) : view.main === 'map' ? (
            <RouteView
              route={record.route}
              trips={trips.data ?? undefined}
              stops={stops.data ?? undefined}
              picked={picked}
              onPick={setPicked}
            />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-body-medium text-muted-foreground">
              The route map is off on this server, so the shift is shown as a list only.
            </p>
          )}
        </div>
        <Section
          label="Timeline"
          title="Timeline"
          action={
            // With nothing recorded, the button sits in the card that explains why (once).
            view.canAddTrip && !adding ? (
              <UiButton variant="outline" size="sm" onClick={() => setAdding(true)}>
                Add a trip
              </UiButton>
            ) : undefined
          }
          description={view.timelineNote}
        >
          {adding ? <AddTrip shift={shift} onClose={() => setAdding(false)} /> : null}
          {editing ? (
            <AddTrip
              key={editing.id}
              shift={shift}
              trip={editing}
              onClose={() => setEditing(null)}
            />
          ) : null}
          {deleting ? <DeleteTripDialog trip={deleting} onClose={() => setDeleting(null)} /> : null}
          {trips.error ? (
            <p className="text-muted-foreground">Trips could not be loaded. {trips.error}</p>
          ) : trips.data === null ? (
            <p className="text-muted-foreground">Loading trips</p>
          ) : (
            // The negative margin lines the rows' text up with the card's; it sits on the scroll
            // box, not the list, so the list is never wider than the box and cannot scroll sideways
            // (which cut the first digit off the times). Where the box scrolls, 6 px of padding
            // (taken back by the margin) leaves room for the focus rings, which it would clip.
            <div
              data-timeline-scroll
              className="-mx-2 @3xl:-m-1.5 @3xl:-mx-3.5 @3xl:max-h-[30rem] @3xl:overflow-x-hidden @3xl:overflow-y-auto @3xl:p-1.5"
            >
              {view.noTrips ? (
                <p className="mb-2 px-2 text-muted-foreground">No trips were recorded.</p>
              ) : null}
              <ShiftTimeline
                shift={shift}
                trips={trips.data}
                stops={stops.data ?? []}
                split={view.split}
                est={<Est />}
                picked={picked}
                onPick={setPicked}
                onEditTrip={
                  view.canEditTrips
                    ? (t) => {
                        setAdding(false);
                        setEditing(t);
                      }
                    : undefined
                }
                onDeleteTrip={view.canEditTrips ? setDeleting : undefined}
              />
            </div>
          )}
        </Section>
      </div>

      {view.folded ? (
        <div
          className={cn(
            'grid items-start gap-6',
            view.showEarnings && '@3xl:grid-cols-[minmax(0,1fr)_22rem]',
          )}
        >
          {view.showEarnings ? (
            <div className="min-w-0">
              <ShiftEarnings shift={shift} earnings={record.earnings} />
            </div>
          ) : null}
          <div className={cn('min-w-0 space-y-6', !view.showEarnings && 'max-w-xl')}>
            {view.checks ? (
              <div id="checks" className="scroll-mt-20">
                <ShiftChecks shift={shift} />
              </div>
            ) : null}
            <MoreCard
              rows={[
                {
                  key: 'odometer',
                  title: 'Odometer',
                  hint: 'Start and end readings, if you noted them',
                  body: <ShiftOdometer shift={shift} readings={record.odometer} bare />,
                },
                {
                  key: 'notes',
                  title: 'Notes',
                  hint: shift.notes ?? 'None yet',
                  open: !!shift.notes,
                  body: notes(true),
                },
                ...(view.costs
                  ? [
                      {
                        key: 'costs',
                        title: 'Parking and tolls',
                        hint:
                          costs.items && costs.items.length > 0
                            ? `${formatMoney(costs.totalCents, settings.currency)} on this shift`
                            : 'None yet',
                        body: <ShiftCosts shift={shift} bare />,
                      },
                    ]
                  : []),
                ...(view.exporters
                  ? [
                      {
                        key: 'export',
                        title: 'Export',
                        hint: 'Download this shift as a file',
                        body: exportButtons,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            {view.showEarnings ? <ShiftEarnings shift={shift} earnings={record.earnings} /> : null}
            <ShiftOdometer shift={shift} readings={record.odometer} />
          </div>
          <div className="min-w-0 space-y-6">
            <div id="checks" className="scroll-mt-20">
              <ShiftChecks shift={shift} />
            </div>
            {view.costs ? <ShiftCosts shift={shift} /> : null}
            {notes()}
            {view.exporters ? (
              <Section label="Export" title="Export this shift">
                {exportButtons}
              </Section>
            ) : null}
          </div>
        </div>
      )}

      {view.stopsCard ? (
        <Section
          label="Stops"
          title="Label stops"
          description="Optional. A label corrects the estimate for that stop and adds its fare."
        >
          <StopsPanel shift={shift} data={stops} />
        </Section>
      ) : null}
    </section>
  );
}

export function ShiftsRoutes() {
  return (
    <Routes>
      <Route index element={<ShiftList />} />
      <Route path=":ref" element={<ShiftDetail />} />
    </Routes>
  );
}
