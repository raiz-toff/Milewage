// Comma sanity check (14 section 10.2 item 2). NOT a golden test: Comma deletes raw points,
// so all that survives of a past shift is its simplified `routePath` and its stored total.
// The check compares the haversine length of that route with the stored total. The route is a
// 10 m RDP simplification of the points the total was summed over, so its length can only be
// shorter (triangle inequality), by an amount that depends on how winding the ride was.
// A gross engine or unit error shows up as a large difference; a small shortfall is expected.
import { degToE7, haversineDm, dmToM, type RoutePoint } from '../../src/index';
import type { Io } from './conformance';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Comma's `routePath`: a JSON array of points, or a Google encoded polyline (1e5 precision). */
export function parseRoutePath(routePath: string | null | undefined): LatLng[] | null {
  if (!routePath) return null;
  const s = routePath.trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s) as Record<string, unknown>[];
      const pts: LatLng[] = [];
      for (const p of arr) {
        const lat = p.latitude ?? p.lat;
        const lon = p.longitude ?? p.lng ?? p.lon;
        if (typeof lat === 'number' && typeof lon === 'number')
          pts.push({ latitude: lat, longitude: lon });
      }
      return pts.length >= 2 ? pts : null;
    } catch {
      return null; // fall through is wrong for a string starting with '[': it is not a polyline
    }
  }
  return decodePolyline(s);
}

export function decodePolyline(encoded: string): LatLng[] | null {
  const pts: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= encoded.length) return null;
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return null;
    lat += dLat;
    lng += dLng;
    pts.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return pts.length >= 2 ? pts : null;
}

export function encodePolyline(points: readonly LatLng[]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number): string => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode(((n & 0x1f) | 0x20) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5);
    const lng = Math.round(p.longitude * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

/** Route length in whole metres, summing the engine's own decimetre haversine. */
export function routeLengthM(points: readonly LatLng[]): number {
  let dm = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    dm += haversineDm(
      degToE7(a.latitude),
      degToE7(a.longitude),
      degToE7(b.latitude),
      degToE7(b.longitude),
    );
  }
  return dmToM(dm);
}

export function toLatLng(route: readonly RoutePoint[]): LatLng[] {
  return route.map((p) => ({ latitude: p.latE7 / 1e7, longitude: p.lonE7 / 1e7 }));
}

/** One exported Comma shift: `routePath` plus the stored total in `trackedMileage` (display unit). */
export interface CommaShift {
  id: string;
  routePath: string | null;
  trackedMileage: number;
}

/**
 * GUESSES until the owner's export exists (no data was available when this was written):
 * the route may be up to 4% shorter than the stored total (10 m simplification on a winding
 * city ride) and at most 1% longer (rounding of the stored total, polyline quantization).
 * Shifts under 1 km are skipped: a 0.01 rounding step is already 1% there.
 */
export interface Options {
  unit: 'km' | 'mi';
  maxUnderPct: number;
  maxOverPct: number;
  minStoredM: number;
}
export const DEFAULTS: Options = { unit: 'km', maxUnderPct: 4, maxOverPct: 1, minStoredM: 1000 };
const M_PER_UNIT = { km: 1000, mi: 1609.344 };

export interface Row {
  id: string;
  storedM: number;
  routeM: number;
  diffPct: number; // (route - stored) / stored * 100, one decimal
  status: 'ok' | 'too_short' | 'too_long' | 'skipped' | 'no_route';
}

export function sanityCheck(shifts: readonly CommaShift[], opts: Options = DEFAULTS): Row[] {
  return shifts.map((s) => {
    const storedM = Math.round(s.trackedMileage * M_PER_UNIT[opts.unit]);
    const pts = parseRoutePath(s.routePath);
    if (pts === null) return { id: s.id, storedM, routeM: 0, diffPct: 0, status: 'no_route' };
    const routeM = routeLengthM(pts);
    if (storedM < opts.minStoredM)
      return { id: s.id, storedM, routeM, diffPct: 0, status: 'skipped' };
    const diffPct = Math.round(((routeM - storedM) / storedM) * 1000) / 10;
    const status =
      diffPct < -opts.maxUnderPct ? 'too_short' : diffPct > opts.maxOverPct ? 'too_long' : 'ok';
    return { id: s.id, storedM, routeM, diffPct, status };
  });
}

const USAGE = `usage: comma-sanity <export.json> [--unit km|mi] [--max-under-pct N] [--max-over-pct N] [--min-m N]
export.json: [{ "id": "...", "routePath": "<JSON points or encoded polyline>", "trackedMileage": 12.34 }, ...]
exit 0 = every checked shift within the limits, 1 = at least one outside, 2 = bad usage`;

export function run(argv: readonly string[], io: Io): number {
  const file = argv.find(
    (a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true,
  );
  if (!file) {
    io.out(USAGE + '\n');
    return 2;
  }
  const opts: Options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--unit' && (v === 'km' || v === 'mi')) opts.unit = v;
    else if (argv[i] === '--max-under-pct' && v) opts.maxUnderPct = Number(v);
    else if (argv[i] === '--max-over-pct' && v) opts.maxOverPct = Number(v);
    else if (argv[i] === '--min-m' && v) opts.minStoredM = Number(v);
  }
  if (![opts.maxUnderPct, opts.maxOverPct, opts.minStoredM].every(Number.isFinite)) {
    io.out(USAGE + '\n');
    return 2;
  }
  const shifts = JSON.parse(io.read(file)) as CommaShift[];
  const rows = sanityCheck(shifts, opts);
  io.out(
    `${'id'.padEnd(24)} ${'stored m'.padStart(9)} ${'route m'.padStart(9)} ${'diff %'.padStart(7)}  status\n`,
  );
  for (const r of rows) {
    io.out(
      `${r.id.padEnd(24)} ${String(r.storedM).padStart(9)} ${String(r.routeM).padStart(9)} ${r.diffPct.toFixed(1).padStart(7)}  ${r.status}\n`,
    );
  }
  const bad = rows.filter((r) => r.status === 'too_short' || r.status === 'too_long').length;
  const checked = rows.filter((r) => r.status !== 'skipped' && r.status !== 'no_route').length;
  io.out(
    `${checked} checked, ${bad} outside the limits (under ${opts.maxUnderPct}% / over ${opts.maxOverPct}%; limits are guesses)\n`,
  );
  return bad === 0 ? 0 : 1;
}
