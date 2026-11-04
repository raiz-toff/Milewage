import type { Schemas } from '../api/client';

export type RouteData = Schemas['Route'];

export interface RoutePoint {
  t: number;
  lat: number;
  lon: number;
  /** Metres per second; null for archived routes (08 Route.speed_dmps is null-filled). */
  speed: number | null;
}

/** Columnar arrays to points. Arrays of unequal length are cut to the shortest, never padded. */
export function toPoints(route: RouteData): RoutePoint[] {
  const n = Math.min(route.t.length, route.lat_e7.length, route.lon_e7.length);
  const points: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    const dmps = route.speed_dmps?.[i];
    points.push({
      t: route.t[i]!,
      lat: route.lat_e7[i]! / 1e7,
      lon: route.lon_e7[i]! / 1e7,
      speed: typeof dmps === 'number' ? dmps / 10 : null,
    });
  }
  return points;
}

/** [west, south, east, north], or null when there are no points. */
export function boundsOf(points: RoutePoint[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [w, s, e, n];
}

/** Where the vehicle was at time `t`: linear between the two surrounding fixes, clamped to the ends. */
export function positionAt(points: RoutePoint[], t: number): RoutePoint | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (t <= first.t) return first;
  if (t >= last.t) return last;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return {
    t,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    speed: a.speed !== null && b.speed !== null ? a.speed + (b.speed - a.speed) * f : null,
  };
}

/** Slider position (0 to `steps`) to a time within the route, and back. */
export const timeAt = (points: RoutePoint[], step: number, steps: number): number => {
  const a = points[0]?.t ?? 0;
  const b = points[points.length - 1]?.t ?? a;
  return Math.round(a + ((b - a) * Math.min(Math.max(step, 0), steps)) / steps);
};

export const stepOf = (points: RoutePoint[], t: number, steps: number): number => {
  const a = points[0]?.t ?? 0;
  const b = points[points.length - 1]?.t ?? a;
  return b === a ? 0 : Math.round(((t - a) / (b - a)) * steps);
};

/** Speed for display in the driver's unit; null stays null (an archived route has none). */
export function speedIn(mps: number | null, unit: 'km' | 'mi'): string {
  if (mps === null) return '—';
  return unit === 'km' ? `${Math.round(mps * 3.6)} km/h` : `${Math.round(mps * 2.236936)} mph`;
}

/** GeoJSON line for the map source. Longitude first, as GeoJSON requires. */
export function lineOf(points: RoutePoint[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map((p) => [p.lon, p.lat]),
    },
  };
}
