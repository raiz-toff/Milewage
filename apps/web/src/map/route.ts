import type { Schemas } from '../api/client';

export type RouteData = Schemas['Route'];

export interface RoutePoint {
  t: number;
  lat: number;
  lon: number;
}

/** Columnar arrays to points. Arrays of unequal length are cut to the shortest, never padded. */
export function toPoints(route: RouteData): RoutePoint[] {
  const n = Math.min(route.t.length, route.lat_e7.length, route.lon_e7.length);
  const points: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({
      t: route.t[i]!,
      lat: route.lat_e7[i]! / 1e7,
      lon: route.lon_e7[i]! / 1e7,
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
  };
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

/** The part of the route between two times (a trip), with the ends placed on the line. */
export function segmentOf(points: RoutePoint[], from: number, to: number): RoutePoint[] {
  const a = positionAt(points, from);
  const b = positionAt(points, to);
  if (!a || !b || to <= from) return [];
  return [a, ...points.filter((p) => p.t > from && p.t < to), b];
}
