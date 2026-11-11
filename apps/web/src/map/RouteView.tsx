import { lazy, Suspense, useMemo } from 'react';
import { Section } from '../ui/layout';
import { ApiError } from '../api/client';
import { useApiQuery } from '../api/query';
import type { Schemas } from '../api/client';
import { toPoints } from './route';
import type { RoutePoint } from './route';
import type { MapPick, MapStop } from './MapView';
import type { Picked } from '../shift/view';

const MapView = lazy(() => import('./MapView'));

const NONE: never[] = [];
const NOTE =
  'rounded-xl border border-dashed border-outline-variant p-4 text-body-medium text-muted-foreground';

/** A shift's recorded route; `points` is null while it loads and empty when there is none. */
export interface ShiftRoute {
  points: RoutePoint[] | null;
  source: 'raw' | 'archive';
  note: string | null;
}

/** Reads the route once per shift; asks nothing while `on` is false (tracking off, still running). */
export function useShiftRoute(shiftId: number, on: boolean): ShiftRoute {
  const { data, error } = useApiQuery(
    '/shifts/{ref}/route',
    { params: { path: { ref: String(shiftId) } } },
    { enabled: on },
  );
  return useMemo<ShiftRoute>(() => {
    if (data) return { points: toPoints(data), source: data.source, note: null };
    if (!error) return { points: null, source: 'raw', note: null };
    // 404 is the normal "no route" answer: tracking off on the server, or nothing recorded.
    return {
      points: [],
      source: 'raw',
      note:
        error instanceof ApiError && error.status === 404
          ? 'No route is available for this shift.'
          : 'The route could not be loaded.',
    };
  }, [data, error]);
}

/**
 * Route map for one shift (module `tracking`), with the shift's stops numbered as in the timeline. `picked` (from the timeline) is shown on the map; a stop clicked on the map
 * is picked through `onPick`.
 */
export function RouteView({
  route,
  trips = NONE,
  stops = NONE,
  picked = null,
  onPick,
}: {
  route: ShiftRoute;
  trips?: Schemas['Trip'][];
  stops?: Schemas['Stop'][];
  picked?: Picked;
  onPick?: (p: Picked) => void;
}) {
  const { points, source, note } = route;

  const mapStops = useMemo(
    (): MapStop[] =>
      [...stops]
        .sort((a, b) => a.started_at - b.started_at)
        .map((s, i) => ({
          key: s.stop_key,
          n: i + 1,
          lat: s.lat_e7 / 1e7,
          lon: s.lon_e7 / 1e7,
          low: s.confidence === 'low',
        })),
    [stops],
  );
  const trip = picked?.kind === 'trip' ? trips.find((t) => t.id === picked.id) : undefined;
  const pick: MapPick = trip
    ? { trip: [trip.started_at, trip.ended_at] }
    : picked?.kind === 'stop'
      ? { stop: picked.key }
      : null;

  if (points === null) return <p className="text-muted-foreground">Loading route</p>;
  if (points.length === 0)
    return (
      <p className={NOTE}>
        {note ?? 'No route points were recorded.'} The timeline lists the trips and stops.
      </p>
    );

  return (
    <Section
      label="Route"
      title="Route"
      description="Numbers are the stops in the timeline. Pick a trip or a stop there to find it here."
    >
      <Suspense fallback={<p className="text-muted-foreground">Loading map</p>}>
        <MapView
          points={points}
          stops={mapStops}
          pick={pick}
          onPickStop={(key) => onPick?.({ kind: 'stop', key })}
        />
      </Suspense>
      {source === 'archive' ? (
        <p className="text-body-medium text-muted-foreground">
          Simplified route: raw points were archived.
        </p>
      ) : null}
    </Section>
  );
}
