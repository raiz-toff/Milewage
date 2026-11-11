// The arithmetic every chart shares, as pure functions (tested in test/charts.test.ts). Nice
// numbers and ticks come from d3-array and stacks from d3-shape: small, stable
// modules that own no DOM, so the drawing stays ours and in the system's tokens.
import { nice, ticks } from 'd3-array';
import { stack, stackOffsetDiverging, stackOrderNone } from 'd3-shape';

export interface ValueAxis {
  /** The top of the axis, a nice number at or above the largest value. */
  max: number;
  /** The tick values from 0 to `max`. */
  ticks: number[];
}

/**
 * A value axis from zero: d3's nice top and about `count` ticks (1, 2 or 5 times a power of ten).
 * No data, or only zeros, gives an axis from 0 to 1 with the zero tick alone.
 */
export function valueAxis(max: number, count = 4): ValueAxis {
  if (!(max > 0) || !Number.isFinite(max)) return { max: 1, ticks: [0] };
  const [, top] = nice(0, max, count);
  return { max: top, ticks: ticks(0, top, count) };
}

/** A linear map from [d0, d1] onto [r0, r1]. */
export const linear =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number): number =>
    d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

export interface Bands {
  /** The width of one slot. */
  step: number;
  /** The width of a bar: the slot less the gap, never more than `maxBar`. */
  bar: number;
  /** The left edge of the bar in slot `i`. */
  x: (i: number) => number;
  /** The centre of slot `i`. */
  center: (i: number) => number;
  /** The slot under the horizontal position `px`, or null outside the bands. */
  at: (px: number) => number | null;
}

/** `n` equal slots across `width` from `left`, each holding one bar of at most `maxBar` px. */
export function bands(n: number, left: number, width: number, maxBar = 24, gap = 2): Bands {
  const step = n > 0 ? width / n : width;
  const bar = Math.max(1, Math.min(maxBar, step - gap));
  return {
    step,
    bar,
    x: (i) => left + i * step + (step - bar) / 2,
    center: (i) => left + i * step + step / 2,
    at: (px) => {
      const i = Math.floor((px - left) / step);
      return n > 0 && i >= 0 && i < n ? i : null;
    },
  };
}

/**
 * Every how many slots an axis label fits: the smallest of a few friendly steps whose labels,
 * about `chars` characters each, do not run into each other across `width`.
 */
export function labelStep(n: number, width: number, chars: number): number {
  const need = chars * 6.5 + 8;
  const steps = [1, 2, 3, 4, 5, 6, 7, 10, 14, 15, 20, 30, 50];
  return steps.find((k) => (width / n) * k >= need) ?? Math.max(1, Math.ceil((n * need) / width));
}

/**
 * Stacks rows of values (one row per slot, one value per series) into [bottom, top] pairs per
 * series and slot, with d3's diverging offset: positives stack up from zero and negatives down.
 * A null counts as zero.
 */
export function stackRows(rows: (number | null)[][], seriesCount: number): [number, number][][] {
  const keys = Array.from({ length: seriesCount }, (_, i) => i);
  const layers = stack<(number | null)[], number>()
    .keys(keys)
    .value((row, key) => row[key] ?? 0)
    .order(stackOrderNone)
    .offset(stackOffsetDiverging)(rows);
  return layers.map((layer) => layer.map((p) => [p[0], p[1]] as [number, number]));
}

/** The largest stacked total (positives only) of rows of values. */
export const stackMax = (rows: (number | null)[][]) =>
  Math.max(0, ...rows.map((r) => r.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0)));

/**
 * A rectangle with the top two corners rounded by `r` (a bar's data end; Material and the data-viz
 * spec round the end away from the baseline and keep the base square). `r` shrinks to fit.
 */
export function topRoundedRect(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0 || h <= 0) return '';
  const k = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + k}`,
    `Q${x},${y} ${x + k},${y}`,
    `H${x + w - k}`,
    `Q${x + w},${y} ${x + w},${y + k}`,
    `V${y + h}`,
    'Z',
  ].join('');
}

/** The share of a part in a whole, rounded to a whole percent, so the shares read as 46%. */
export const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;
