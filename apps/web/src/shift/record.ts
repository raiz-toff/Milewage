import { useMemo } from 'react';
import { describe } from '../api/client';
import type { Schemas } from '../api/client';
import { useApiQuery } from '../api/query';
import { dayOf } from '../days';
import { useShiftRoute } from '../map/RouteView';
import type { ShiftRoute } from '../map/RouteView';
import { usePlatformOf } from '../platforms/usePlatforms';
import { useSettings } from '../session';
import { earnedOf, shiftView } from './view';
import type { EarnedSummary, Read, ShiftView } from './view';

type Shift = Schemas['Shift'];
type Reading = Schemas['OdometerReading'];

/** The shift's own start and end odometer readings; null where none was noted. */
export interface ShiftReadings {
  start: Reading | null;
  end: Reading | null;
}

/** One shift and everything the shift page shows about it, from the cached reads. */
export interface ShiftRecord {
  /** Null while it loads, or when it could not be read (then `error` says why). */
  shift: Shift | null;
  error: string | null;
  trips: Read<Schemas['Trip'][]>;
  /** Not asked while the stops module is off. */
  stops: Read<Schemas['Stop'][]>;
  /** Not asked while the shift runs (the route is worked out when it ends) or tracking is off. */
  route: ShiftRoute;
  /** Not asked while the shift runs or the earnings module is off. */
  earnings: Read<Schemas['ShiftEarnings']>;
  /** The earnings as the figures and header show them; null while they load or are not asked. */
  earned: EarnedSummary | null;
  odometer: Read<ShiftReadings>;
  /** The vehicle's name, or null while unknown. */
  vehicle: string | null;
  /** The page's layout and figures (`shiftView`); null until the shift is read. */
  view: ShiftView | null;
}

const failed = (error: unknown) => (error ? describe(error) : null);

/**
 * One shift by its reference, assembled from the cached reads: the shift, its trips, stops,
 * route, earnings, odometer readings and vehicle, and the page's view of them. Every read is a
 * query under its own key, so a change anywhere (which refreshes every cached read) reaches the
 * record, and a panel that saves puts its answer under the same key the record reads.
 */
export function useShiftRecord(ref: string): ShiftRecord {
  const settings = useSettings();
  const { modules, timezone } = settings;
  const shiftQuery = useApiQuery('/shifts/{ref}', { params: { path: { ref } } });
  const shift = shiftQuery.data ?? null;
  const on = !!shift;
  const ended = on && shift.status !== 'active';
  // What belongs to the shift is read (and put by the panels' saves) under its id.
  const path = { path: { ref: String(shift?.id ?? 0) } };

  const trips = useApiQuery('/shifts/{ref}/trips', { params: path }, { enabled: on });
  const stops = useApiQuery(
    '/shifts/{ref}/stops',
    { params: path },
    { enabled: on && modules.stops },
  );
  const route = useShiftRoute(shift?.id ?? 0, ended && modules.tracking);
  const earnings = useApiQuery(
    '/shifts/{ref}/earnings',
    { params: path },
    { enabled: ended && modules.earnings },
  );
  // The name is a nicety; the page works without it, so a failed request just leaves it out.
  const vehicles = useApiQuery(
    '/vehicles',
    { params: { query: { include_archived: true } } },
    { enabled: !!shift?.vehicle_id },
  ).data;

  // A shift that runs past midnight can have its end reading on the next local day.
  const lastDay = shift?.ended_at ? dayOf(shift.ended_at, timezone) : (shift?.local_date ?? '');
  const readings = (kind: 'shift_start' | 'shift_end') => ({
    params: {
      query: {
        vehicle_id: shift?.vehicle_id,
        kind,
        from: shift?.local_date ?? '',
        to: shift && lastDay > shift.local_date ? lastDay : (shift?.local_date ?? ''),
      },
    },
  });
  const starts = useApiQuery('/odometer', readings('shift_start'), { enabled: on });
  const ends = useApiQuery('/odometer', readings('shift_end'), { enabled: on });
  const mine = (list: Reading[]) => list.find((r) => r.shift_id === shift?.id) ?? null;

  const platformOf = usePlatformOf();
  const earned = useMemo<EarnedSummary | null>(
    () =>
      earnings.data
        ? {
            cents: earnedOf(earnings.data),
            platforms: earnings.data.effective.map((r) => platformOf(r.platform)),
          }
        : null,
    [earnings.data, platformOf],
  );

  const vehicle =
    (shift?.vehicle_id && vehicles?.find((v) => v.id === shift.vehicle_id)?.name) || null;
  const record: Omit<ShiftRecord, 'view'> = {
    shift,
    error: failed(shiftQuery.error),
    trips: { data: trips.data ?? null, error: failed(trips.error) },
    stops: { data: stops.data ?? null, error: failed(stops.error) },
    route,
    earnings: { data: earnings.data ?? null, error: failed(earnings.error) },
    earned,
    odometer: {
      data: starts.data && ends.data ? { start: mine(starts.data), end: mine(ends.data) } : null,
      error: failed(starts.error ?? ends.error),
    },
    vehicle,
  };
  return { ...record, view: shift ? shiftView({ ...record, shift }, settings) : null };
}
