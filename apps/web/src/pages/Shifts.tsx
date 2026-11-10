import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, PageHeader, Section, StatCard } from '../ui/layout';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons';
import { Badge } from '@/components/ui/badge';
import { Button as UiButton } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { describe, unwrap } from '../api/client';
import type { Schemas, Settings } from '../api/client';
import { useApiQuery } from '../api/query';
import { deductionWord, formatDistance, formatDuration, formatMoney, formatTime } from '../format';
import { RouteView } from '../map/RouteView';
import { PlatformName } from '../platforms/PlatformBadge';
import { addDays, dateWords, todayIn, weekOf, weekWords } from '../days';
import { useSession, useSettings } from '../session';
import { useShiftRecord } from '../shift/record';
import { reviewCount, showsSplit } from '../shift/view';
import type { Picked } from '../shift/view';
import { FormError } from '../ui/form';
import { ExportButtons } from './Exports';
import { AddTrip, DeleteTripDialog } from './AddTrip';
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
  const tf = settings.time_format;
  const split = showsSplit(shift, settings);
  const review = reviewCount(shift);
  return (
    <Link
      to={`/shifts/${shift.id}`}
      className="relative block rounded-medium bg-card p-4 state-layer focus-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-title-medium">
              {dateWords(shift.local_date, { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
            <StatusBadge shift={shift} />
            {review > 0 ? (
              <Badge variant="outline" className="border-primary/60">
                {review} to review
              </Badge>
            ) : null}
          </div>
          <p className="text-body-medium text-muted-foreground tabular-nums">
            {formatTime(shift.started_at, tz, tf)} –{' '}
            {shift.ended_at ? formatTime(shift.ended_at, tz, tf) : 'now'} ·{' '}
            {formatDuration(shift.started_at, shift.ended_at)}
          </p>
          {shift.notes ? (
            <p className="truncate text-body-medium text-muted-foreground italic">
              “{shift.notes}”
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-title-large font-medium tabular-nums">
            {formatDistance(shift.total_m, unit)}
          </div>
          {split ? (
            <div className="text-body-small text-muted-foreground tabular-nums">
              {formatDistance(shift.active_m, unit)} active
              <Est />
            </div>
          ) : null}
          {shift.deduction_cents !== null ? (
            <div className="text-body-small text-muted-foreground tabular-nums">
              {formatMoney(shift.deduction_cents, settings.currency)}{' '}
              {deductionWord({
                mileage_rate: settings.mileage_rate,
                deduction_rate: shift.deduction_rate,
              })}
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
        <h1 className="text-headline-small text-on-surface md:text-headline-medium">Shifts</h1>
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
          <ChevronLeftIcon />
        </UiButton>
        <div className="min-w-0 text-center">
          <div className="text-title-small text-muted-foreground">{heroLabel}</div>
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
          aria-label="Next week"
          disabled={from >= thisWeek}
          onClick={() => go(addDays(from, 7))}
        >
          <ChevronRightIcon />
        </UiButton>
      </div>

      <Card>
        <CardContent>
          <div className="relative flex h-40 items-stretch gap-2 sm:gap-3">
            {high > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2">
                <div className="flex-1 border-t border-dashed" />
                <span className="text-label-small text-muted-foreground tabular-nums">
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
          {picked ? `Shifts on ${dateWords(picked.date, { weekday: 'long' })}` : 'Shifts this week'}
        </h2>
        <FormError message={error} />
        {!data && !error ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : data && listed.length === 0 ? (
          <EmptyState>
            {picked ? 'No shifts on this day.' : 'No shifts this week. Shifts start on the phone.'}
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
                replay={settings.modules.replay}
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
