import { E7, roundHalfUp } from './ints';
import { EARTH_RADIUS_M } from './haversine';

// Stage 8: route simplification for display and replay only. No total is ever computed
// from the simplified route (14 section 5.5). Own Ramer-Douglas-Peucker, no dependency.

export interface RoutePoint {
  latE7: number;
  lonE7: number;
  t: number;
}

/** Display tolerance: 10 m = 100 dm (14 section 4). The 90-day archive uses 5 m (M6.6). */
export const ROUTE_TOLERANCE_DM = 100;

const COS_SCALE = 1_000_000;
// Decimetres per E7 unit of latitude, on the sphere of haversine.ts. Only IEEE-exact
// operations (+ - * / and sqrt) are used below, so the result is the same on every engine.
const DM_PER_E7 = (EARTH_RADIUS_M * Math.PI * 10) / (180 * E7);

/**
 * Integer-input RDP in a local equirectangular projection around the first point.
 * The one transcendental call (cos of the first latitude) is rounded to an integer
 * before use, so engines would have to differ by 1e-6 to disagree. First and last points
 * are always kept; the output keeps input order and carries each point's timestamp.
 */
export function simplifyRoute(
  points: readonly RoutePoint[],
  toleranceDm: number = ROUTE_TOLERANCE_DM,
): RoutePoint[] {
  const n = points.length;
  if (n <= 2) return points.map((p) => ({ ...p }));
  const lat0 = points[0]!.latE7;
  const lon0 = points[0]!.lonE7;
  const cosQ = roundHalfUp(Math.cos((lat0 / E7) * (Math.PI / 180)) * COS_SCALE);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    xs[i] = (((p.lonE7 - lon0) * cosQ) / COS_SCALE) * DM_PER_E7;
    ys[i] = (p.latE7 - lat0) * DM_PER_E7;
  }
  const tol2 = toleranceDm * toleranceDm;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const hi = stack.pop()!;
    const lo = stack.pop()!;
    if (hi - lo < 2) continue;
    const ax = xs[lo]!;
    const ay = ys[lo]!;
    const dx = xs[hi]! - ax;
    const dy = ys[hi]! - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worst2 = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = xs[i]! - ax;
      const py = ys[i]! - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const u = (px * dx + py * dy) / len2;
        const c = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = px - c * dx;
        const ey = py - c * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worst2) {
        worst2 = d2;
        worst = i;
      }
    }
    if (worst2 > tol2) {
      keep[worst] = 1;
      stack.push(lo, worst, worst, hi);
    }
  }
  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ ...points[i]! });
  return out;
}
