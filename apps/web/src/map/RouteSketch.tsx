import type { RouteData } from './route';
import { toPoints } from './route';

const W = 64;
const H = 48;
const PAD = 5;
const MAX_POINTS = 150;

/**
 * The route as a small line drawing (Comma's route minimap), no basemap and no map library: the
 * points are projected flat (longitude scaled by the cosine of the latitude), fitted into the
 * box keeping their shape, and thinned to at most 150. Returns null for fewer than two points.
 */
export function sketchPath(route: RouteData, w = W, h = H, pad = PAD): string | null {
  const all = toPoints(route);
  if (all.length < 2) return null;
  const step = Math.ceil(all.length / MAX_POINTS);
  const pts = all.filter((_, i) => i % step === 0 || i === all.length - 1);
  const k = Math.cos((pts[0]!.lat * Math.PI) / 180);
  const xs = pts.map((p) => p.lon * k);
  const ys = pts.map((p) => -p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // A straight east-west or north-south line has no height or width: fit the other side.
  const fit = (room: number, span: number) => (span > 0 ? room / span : Infinity);
  const best = Math.min(fit(w - 2 * pad, x1 - x0), fit(h - 2 * pad, y1 - y0));
  const scale = Number.isFinite(best) ? best : 1;
  const dx = (w - (x1 - x0) * scale) / 2;
  const dy = (h - (y1 - y0) * scale) / 2;
  return xs
    .map(
      (x, i) => `${((x - x0) * scale + dx).toFixed(1)},${((ys[i]! - y0) * scale + dy).toFixed(1)}`,
    )
    .join(' ');
}

/**
 * Decorative: the row it sits in says the date, time, distance and earnings, and the shift page
 * has the full map, so it is hidden from screen readers. Drawn in the text colour (`currentColor`)
 * as a quiet ink line: the Lane yellow route belongs to the shift's map, and five yellow sketches
 * in a list would make the yellow the most common colour on the dashboard.
 */
export function RouteSketch({ route }: { route: RouteData }) {
  const path = sketchPath(route);
  if (!path) return null;
  return (
    <svg
      aria-hidden="true"
      data-testid="route-sketch"
      viewBox={`0 0 ${W} ${H}`}
      className="size-full"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={path} stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
