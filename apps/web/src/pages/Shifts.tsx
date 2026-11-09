import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Section, StatCard } from '../ui/layout';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { useApiQuery } from '../api/query';
import { deductionWord, formatDistance, formatDuration, formatMoney, formatTime } from '../format';
import { RouteView, useShiftRoute } from '../map/RouteView';
import { PlatformName } from '../platforms/PlatformBadge';
import { addDays, dateWords, todayIn, weekOf, weekWords } from '../days';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';
import { ExportButtons } from './Exports';
import { AddTrip } from './AddTrip';
import { ShiftEarnings } from './ShiftEarnings';
import { ShiftChecks, ShiftFigures, useVehicleName } from './ShiftFacts';
import type { EarnedSummary } from './ShiftFacts';
import { ShiftOdometer } from './ShiftOdometer';
import { InProgressCard, MoreCard, NoRouteCard, ShiftNotes } from './ShiftStates';
import { ShiftTimeline } from './ShiftTimeline';
import type { Picked } from './ShiftTimeline';
import { StopsPanel, useShiftStops } from './Stops';
import { useShiftTrips } from './Trips';

type Shift = Schemas['Shift'];

/** The split is shown only while stops are on and only for a shift that was segmented by stops. */
export const showsSplit = (s: Shift, settings: Settings) =>
  settings.modules.stops && s.segmenter === 'stops';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** An estimate always carries its marker (05 section 3.1a). Totals never do. */
export function Est() {
  return (
    <abbr title="Estimated from detected stops" className="ml-0.5 cursor-help no-underline">
      *
    </abbr>
  );
}

const isDate = (d: string | null): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

type Summary = Schemas['Summary'];
interface DayBucket {
  start: string;
  earnings_cents: number | null;
  hours: number;
  hourly_cents: number | null;
}
interface WeekData {
  shifts: Shift[];
  summary: Summary;
  /** Per-day earnings from the analytics module; null when that module is off. */
  buckets: DayBucket[] | null;
}

/** Everything the week view needs: the week's shifts (all pages), its summary, and per-day earnings. */
function useWeek(from: string, to: string) {
  const { api } = useSession();
  const settings = useSettings();
  const analyticsOn = settings.modules.analytics;
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
  const analytics = useApiQuery(
    '/analytics',
    { params: { query: { from, to, group: 'trends', bucket: 'day' } } },
    { enabled: analyticsOn },
  );
  const buckets = analyticsOn
    ? analytics.data && ((analytics.data.data as { buckets?: DayBucket[] } | null)?.buckets ?? [])
    : null;
  const failed = [shifts, summary, ...(analyticsOn ? [analytics] : [])].find((q) => q.error);
  const data: WeekData | null =
    shifts.data && summary.data && buckets !== undefined
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

export function ShiftCard({ shift, settings }: { shift: Shift; settings: Settings }) {
  const unit = settings.distance_unit;
  const tz = settings.timezone;
  const split = showsSplit(shift, settings);
  const review = shift.flags?.filter((f) => f.severity === 'review').length ?? 0;
  return (
    <Link
      to={`/shifts/${shift.id}`}
      className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {dateWords(shift.local_date, { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
            <StatusBadge shift={shift} />
            {review > 0 ? (
              <Badge variant="outline" className="border-primary/60">
                {review} to review
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatTime(shift.started_at, tz)} –{' '}
            {shift.ended_at ? formatTime(shift.ended_at, tz) : 'now'} ·{' '}
            {formatDuration(shift.started_at, shift.ended_at)}
          </p>
          {shift.notes ? (
            <p className="truncate text-sm text-muted-foreground italic">“{shift.notes}”</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular-nums text-lg font-semibold">
            {formatDistance(shift.total_m, unit)}
          </div>
          {split ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatDistance(shift.active_m, unit)} active
              <Est />
            </div>
          ) : null}
          {shift.deduction_cents !== null ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatMoney(shift.deduction_cents, settings.currency)} {deductionWord(settings)}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/** The week of shifts (Comma's layout): week total, a bar per day, week figures, then the list. */
export function ShiftList() {
  const settings = useSettings();
  const unit = settings.distance_unit;
  const currency = settings.currency;
  const [params, setParams] = useSearchParams();
  const today = todayIn(settings.timezone);
  const thisWeek = weekOf(today, settings.week_start);
  const asked = params.get('week');
  const from = weekOf(isDate(asked) ? asked : today, settings.week_start);
  const to = addDays(from, 6);
  const { data, error } = useWeek(from, to);
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => setDay(null), [from]);

  const go = (week: string) => setParams(week === thisWeek ? {} : { week });

  const shifts = [...(data?.shifts ?? [])].sort((a, b) => b.started_at - a.started_at);
  const earnedWeek = data?.summary.earnings_cents ?? null;
  // Bars show money when there is money and a per-day breakdown of it; otherwise distance.
  const byMoney = earnedWeek !== null && data?.buckets != null;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const own = shifts.filter((s) => s.local_date === date);
    return {
      date,
      shifts: own,
      distance: own.reduce((t, s) => t + (s.total_m ?? 0), 0),
      earned: data?.buckets?.find((b) => b.start === date)?.earnings_cents ?? null,
    };
  });
  const valueOf = (d: (typeof days)[number]) => (byMoney ? (d.earned ?? 0) : d.distance);
  const words = (d: (typeof days)[number]) =>
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
    ? dateWords(picked.date, { weekday: 'long', month: 'short', day: 'numeric' })
    : weekWords(from, to);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
        {from !== thisWeek ? (
          <UiButton variant="outline" size="sm" onClick={() => go(thisWeek)}>
            This week
          </UiButton>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <UiButton
          variant="ghost"
          size="icon"
          aria-label="Previous week"
          onClick={() => go(addDays(from, -7))}
        >
          <ChevronLeft />
        </UiButton>
        <div className="min-w-0 text-center">
          <div className="text-sm text-muted-foreground">{heroLabel}</div>
          <div
            aria-live="polite"
            className="truncate tabular-nums text-4xl font-semibold tracking-tight sm:text-5xl"
          >
            {data ? hero : <Skeleton className="mx-auto mt-1 h-10 w-40" />}
          </div>
          {data ? (
            <div className="mt-1 text-xs text-muted-foreground">
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
          aria-label="Next week"
          disabled={from >= thisWeek}
          onClick={() => go(addDays(from, 7))}
        >
          <ChevronRight />
        </UiButton>
      </div>

      <Card>
        <CardContent>
          <div className="relative flex h-40 items-stretch gap-2 sm:gap-3">
            {high > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2">
                <div className="flex-1 border-t border-dashed" />
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  High {byMoney ? formatMoney(high, currency) : formatDistance(high, unit)}
                </span>
              </div>
            ) : null}
            {days.map((d) => {
              const selected = d.date === day;
              const value = valueOf(d);
              const pct = high > 0 ? (value / high) * 100 : 0;
              const dim = day !== null && !selected;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${dateWords(d.date, { weekday: 'long' })}: ${words(d)}`}
                  onClick={() => setDay(selected ? null : d.date)}
                  className="group flex flex-1 flex-col items-center gap-2 rounded-md pt-6 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex w-full flex-1 items-end justify-center">
                    <div
                      className={cn(
                        'w-full max-w-12 rounded-md transition-all',
                        value > 0 ? 'bg-primary' : 'bg-muted',
                        dim && 'opacity-35',
                        !dim && 'group-hover:opacity-90',
                      )}
                      style={{ height: `${value > 0 ? Math.max(pct, 6) : 3}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-xs',
                      selected || d.date === today
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {dateWords(d.date, { weekday: 'short' })}
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
            label={deductionWord(settings, true)}
            value={formatMoney(data.summary.deduction_cents, currency)}
          />
          <StatCard
            label="Hourly earnings"
            value={earnedWords(data.summary.hourly_earnings_cents, currency)}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {picked ? `Shifts on ${dateWords(picked.date, { weekday: 'long' })}` : 'Shifts this week'}
        </h2>
        <FormError message={error} />
        {!data && !error ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : data && listed.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {picked ? 'No shifts on this day.' : 'No shifts this week. Shifts start on the phone.'}
          </div>
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
          <p className="text-xs text-muted-foreground">* estimated from detected stops</p>
        ) : null}
      </div>
    </section>
  );
}

export function ShiftDetail() {
  const { ref } = useParams();
  const settings = useSettings();
  const asked = { path: { ref: ref ?? '' } };
  const shiftQuery = useApiQuery('/shifts/{ref}', { params: asked });
  const shift = shiftQuery.data ?? null;
  const error = shiftQuery.error ? describe(shiftQuery.error) : null;
  const [earned, setEarned] = useState<EarnedSummary | null>(null);
  const vehicle = useVehicleName(shift?.vehicle_id ?? 0);
  const [picked, setPicked] = useState<Picked>(null);
  const [adding, setAdding] = useState(false);
  const { trips, error: tripsError } = useShiftTrips(shift?.id ?? 0);
  const stopsData = useShiftStops(shift?.id ?? 0, !!shift && settings.modules.stops);
  // A running shift has no route yet (worked out when it ends), so it is not asked for.
  const route = useShiftRoute(
    shift?.id ?? 0,
    !!shift && shift.status !== 'active' && settings.modules.replay,
  );

  if (error && !shift)
    return (
      <p role="alert" className="text-muted-foreground">
        {error}
      </p>
    );
  if (!shift) return <p className="text-muted-foreground">Loading</p>;
  const active = shift.status === 'active';
  // The split means nothing on a shift with no distance yet (running, or nothing recorded).
  const split = showsSplit(shift, settings) && !!shift.total_m;
  const tz = settings.timezone;
  const replay = settings.modules.replay;
  const showEarnings = settings.modules.earnings && !active;
  const review = shift.flags?.filter((f) => f.severity === 'review').length ?? 0;
  const context = [
    `${formatTime(shift.started_at, tz)} – ${shift.ended_at ? formatTime(shift.ended_at, tz) : 'now'}`,
    formatDuration(shift.started_at, shift.ended_at),
    vehicle,
  ].filter(Boolean);
  const platforms = showEarnings ? (earned?.platforms ?? []) : [];
  const stops = stopsData.stops ?? [];
  // Nothing was recorded: no trips, no stops and no route points (or no map to ask).
  const empty =
    !active && trips?.length === 0 && stops.length === 0 && (!replay || route.points?.length === 0);
  const orphans = shift.flags?.some((f) => f.code === 'label_orphaned');
  // Only start and end in the timeline.
  const sparse = active || empty;
  // Little to show (also a shift without stops): the quieter tools fold into one "More" card.
  const folded = sparse || (stopsData.stops?.length === 0 && !orphans);
  // Label stops only when there is a stop to label, or a label that lost its stop.
  const showLabels =
    settings.modules.stops && (stopsData.stops === null || stops.length > 0 || orphans);
  const exporters = settings.modules.exporters.length > 0 && !active;

  const notes = (bare?: boolean) => <ShiftNotes shift={shift} bare={bare} />;
  const exportButtons = <ExportButtons selection={{ shift_id: shift.id }} />;

  return (
    <section className="@container space-y-6">
      <UiButton asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={`/shifts?week=${weekOf(shift.local_date, settings.week_start)}`}>
          <ChevronLeft />
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
            {context.join(' · ')}
            {platforms.map((p) => (
              <span key={p.slug}>
                {' · '}
                <PlatformName platform={p} className="align-middle" />
              </span>
            ))}
          </span>
        }
      >
        <StatusBadge shift={shift} />
        {review > 0 ? (
          <Badge asChild variant="outline" className="border-primary/60">
            <a href="#checks">{review} to review</a>
          </Badge>
        ) : null}
      </PageHeader>

      <div className="space-y-2">
        <ShiftFigures
          shift={shift}
          settings={settings}
          split={split}
          earned={showEarnings ? earned : undefined}
          est={<Est />}
        />
        {split ? (
          <p className="text-xs text-muted-foreground">* estimated from detected stops</p>
        ) : null}
      </div>

      <div
        className={cn(
          'grid items-start gap-6',
          (replay || sparse) && '@3xl:grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        <div className="min-w-0">
          {active ? (
            <InProgressCard earnings={settings.modules.earnings} />
          ) : empty ? (
            <div id="checks" className="scroll-mt-20">
              <NoRouteCard shift={shift} replay={replay} onAdd={() => setAdding(true)} />
            </div>
          ) : replay ? (
            <RouteView
              route={route}
              trips={trips ?? undefined}
              stops={stopsData.stops ?? undefined}
              picked={picked}
              onPick={setPicked}
            />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              The route map is off on this server, so the shift is shown as a list only.
            </p>
          )}
        </div>
        <Section
          label="Timeline"
          title="Timeline"
          action={
            // With nothing recorded, the button sits in the card that explains why (once).
            shift.status === 'ended' && !adding && !empty ? (
              <UiButton variant="outline" size="sm" onClick={() => setAdding(true)}>
                Add a trip
              </UiButton>
            ) : undefined
          }
          description={
            sparse
              ? 'Start and end only'
              : trips
                ? [count(trips.length, 'trip'), stopsData.stops && count(stops.length, 'stop')]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
          }
        >
          {adding ? (
            <AddTrip
              shift={shift}
              onCancel={() => setAdding(false)}
              onSaved={() => setAdding(false)}
            />
          ) : null}
          {tripsError ? (
            <p className="text-muted-foreground">Trips could not be loaded. {tripsError}</p>
          ) : trips === null ? (
            <p className="text-muted-foreground">Loading trips</p>
          ) : (
            <div data-timeline-scroll className="@3xl:max-h-[30rem] @3xl:overflow-y-auto">
              {trips.length === 0 && !sparse ? (
                <p className="mb-2 text-muted-foreground">No trips were recorded.</p>
              ) : null}
              <ShiftTimeline
                shift={shift}
                trips={trips}
                stops={stops}
                split={split}
                est={<Est />}
                picked={picked}
                onPick={setPicked}
              />
            </div>
          )}
        </Section>
      </div>

      {folded ? (
        <div
          className={cn(
            'grid items-start gap-6',
            showEarnings && '@3xl:grid-cols-[minmax(0,1fr)_22rem]',
          )}
        >
          {showEarnings ? (
            <div className="min-w-0">
              <ShiftEarnings shift={shift} onSummary={setEarned} />
            </div>
          ) : null}
          <div className={cn('min-w-0 space-y-6', !showEarnings && 'max-w-xl')}>
            {sparse ? null : (
              <div id="checks" className="scroll-mt-20">
                <ShiftChecks shift={shift} />
              </div>
            )}
            <MoreCard
              rows={[
                {
                  key: 'odometer',
                  title: 'Odometer',
                  hint: 'Start and end readings, if you noted them',
                  body: <ShiftOdometer shift={shift} bare />,
                },
                {
                  key: 'notes',
                  title: 'Notes',
                  hint: shift.notes ?? 'None yet',
                  open: !!shift.notes,
                  body: notes(true),
                },
                ...(exporters
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
            {showEarnings ? <ShiftEarnings shift={shift} onSummary={setEarned} /> : null}
            <ShiftOdometer shift={shift} />
          </div>
          <div className="min-w-0 space-y-6">
            <div id="checks" className="scroll-mt-20">
              <ShiftChecks shift={shift} />
            </div>
            {notes()}
            {exporters ? (
              <Section label="Export" title="Export this shift">
                {exportButtons}
              </Section>
            ) : null}
          </div>
        </div>
      )}

      {showLabels && (!folded || orphans) ? (
        <Section
          label="Stops"
          title="Label stops"
          description="Optional. A label corrects the estimate for that stop and adds its payout."
        >
          <StopsPanel shift={shift} data={stopsData} />
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
