import type { Schemas, Settings } from '../api/client';
import { formatDuration, formatTime } from '../format';
import type { PlatformLike } from '../platforms/PlatformBadge';

type Shift = Schemas['Shift'];
type Trip = Schemas['Trip'];
type Stop = Schemas['Stop'];
type Earnings = Schemas['ShiftEarnings'];

/** One of a shift's reads: its answer (null while it loads, or when it is not asked) and why it failed. */
export interface Read<T> {
  data: T | null;
  error: string | null;
}

/** The trip or stop chosen in the timeline, shown on the map too (W2e). */
export type Picked = { kind: 'trip'; id: number } | { kind: 'stop'; key: string } | null;

/** The shift's earnings, for the figures and the header. */
export interface EarnedSummary {
  /** Effective earnings of the shift; null when nothing was entered or labelled. */
  cents: number | null;
  /** The platforms with earnings, for the page header. */
  platforms: PlatformLike[];
}

/** What `shiftView` reads from the shift record: the shift itself and what belongs to it. */
export interface ShiftParts {
  shift: Shift;
  trips: Read<Trip[]>;
  /** Null data while it loads, and when the stops module is off (it is not asked then). */
  stops: Read<Stop[]>;
  /** The route's points: null while they load, empty when there is no route. */
  route: { points: readonly unknown[] | null };
  /** Null while the earnings load, and when they are not asked (module off, still running). */
  earned: EarnedSummary | null;
  vehicle: string | null;
}

/** The split is shown only while stops are on and only for a shift that was segmented by stops. */
export const showsSplit = (s: Shift, settings: Settings) =>
  settings.modules.stops && s.segmenter === 'stops';

/** How many of a shift's flags ask the driver to review something. */
export const reviewCount = (s: Shift) =>
  s.flags?.filter((f) => f.severity === 'review').length ?? 0;

/** Effective earnings after app fees, or null when nothing was entered or labelled. */
export const earnedOf = (e: Earnings): number | null =>
  e.effective.length ? e.effective.reduce((t, r) => t + r.total_cents, 0) : null;

/**
 * What a trip's kind reads as, and whether it is an estimate. With the split off (stops module
 * or setting off, or a shift that was not segmented by stops) active and deadhead are one thing:
 * business. Only the engine's own (auto) active and deadhead are estimates.
 */
export function kindOf(trip: Trip, split: boolean): { text: string; estimated: boolean } {
  if (trip.kind === 'personal') return { text: 'personal', estimated: false };
  if (!split) return { text: 'business', estimated: false };
  return { text: trip.kind, estimated: trip.source === 'auto' };
}

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The shift page's layout and its figures, worked out once from the record and the settings. */
export interface ShiftView {
  /** The shift is still running on the phone. */
  active: boolean;
  /** The estimated active and deadhead split is shown (with its marker). */
  split: boolean;
  /** Flags to review, for the header badge. */
  review: number;
  /** "10:00 – 14:00 · 4h 00m · Corolla": times, length and vehicle for the header. */
  context: string;
  /** Earnings are shown (module on, shift ended). */
  showEarnings: boolean;
  /** Undefined when earnings are not shown; null while they load. */
  earned: EarnedSummary | null | undefined;
  /** The platforms with earnings, for the header. */
  platforms: PlatformLike[];
  /** What takes the map's place: the running card, the nothing-recorded card, the map, or a note. */
  main: 'in-progress' | 'nothing-recorded' | 'map' | 'list';
  /** The map (or the card in its place) and the timeline sit side by side on a wide screen. */
  sideBySide: boolean;
  /** The timeline shows only the start and the end. */
  sparse: boolean;
  /** The timeline's line under its title ("3 trips · 2 stops"). */
  timelineNote: string | undefined;
  /** The timeline says no trips were recorded. */
  noTrips: boolean;
  /** "Add a trip" belongs on the timeline (an ended shift with something recorded). */
  canAddTrip: boolean;
  /** Manual trips can be edited and deleted: an ended shift (finalized shifts never change). */
  canEditTrips: boolean;
  /** Little to show: odometer, notes and export fold into one "More" card. */
  folded: boolean;
  /** The checks card is shown (with nothing recorded, the checks are in that card instead). */
  checks: boolean;
  /** The shift can be exported (the PDF report covers a period, so it does not count). */
  exporters: boolean;
  /** Parking and tolls can be added to the shift (module `expenses`). */
  costs: boolean;
  /** The stop-labelling card is shown. */
  stopsCard: boolean;
}

/**
 * The shift page's layout flags and figures. Pure: the same record and settings always give the
 * same page. The split stays an estimate and labels stay on the web only (decision 1.5b).
 */
export function shiftView(record: ShiftParts, settings: Settings): ShiftView {
  const { shift, trips, stops, route, earned, vehicle } = record;
  const { modules, timezone: tz } = settings;
  const active = shift.status === 'active';
  const replay = modules.replay;
  const showEarnings = modules.earnings && !active;
  const stopList = stops.data ?? [];
  // Nothing was recorded: no trips, no stops and no route points (or no map to ask).
  const empty =
    !active &&
    trips.data?.length === 0 &&
    stopList.length === 0 &&
    (!replay || route.points?.length === 0);
  const orphans = !!shift.flags?.some((f) => f.code === 'label_orphaned');
  // Only start and end in the timeline.
  const sparse = active || empty;
  // Little to show (also a shift without stops): the quieter tools fold into one "More" card.
  const folded = sparse || (stops.data?.length === 0 && !orphans);
  // Label stops only when there is a stop to label, or a label that lost its stop.
  const showLabels = modules.stops && (stops.data === null || stopList.length > 0 || orphans);
  return {
    active,
    // The split means nothing on a shift with no distance yet (running, or nothing recorded).
    split: showsSplit(shift, settings) && !!shift.total_m,
    review: reviewCount(shift),
    context: [
      `${formatTime(shift.started_at, tz)} – ${shift.ended_at ? formatTime(shift.ended_at, tz) : 'now'}`,
      formatDuration(shift.started_at, shift.ended_at),
      vehicle,
    ]
      .filter(Boolean)
      .join(' · '),
    showEarnings,
    earned: showEarnings ? earned : undefined,
    platforms: showEarnings ? (earned?.platforms ?? []) : [],
    main: active ? 'in-progress' : empty ? 'nothing-recorded' : replay ? 'map' : 'list',
    sideBySide: replay || sparse,
    sparse,
    timelineNote: sparse
      ? 'Start and end only'
      : trips.data
        ? [count(trips.data.length, 'trip'), stops.data && count(stopList.length, 'stop')]
            .filter(Boolean)
            .join(' · ')
        : undefined,
    noTrips: trips.data?.length === 0 && !sparse,
    canAddTrip: shift.status === 'ended' && !empty,
    canEditTrips: shift.status === 'ended',
    folded,
    checks: !sparse,
    exporters: modules.exporters.some((f) => f !== 'pdf') && !active,
    // Parking and tolls are paid while the shift runs too.
    costs: modules.expenses,
    stopsCard: showLabels && (!folded || orphans),
  };
}
