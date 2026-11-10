import {
  detectStops,
  haversineDm,
  normalize,
  qualify,
  type ShiftInput,
  type StopLabelInput,
} from '@milewage/track-engine';
import type { PlaceRow } from '../db';

/** A point in degrees x 1e7, as the engine and the stops table keep it. */
interface Point {
  latE7: number;
  lonE7: number;
}

/** Radius limits and the default (ADR 0008): above GPS scatter, below a city block of other stops. */
export const PLACE_RADIUS = { min: 25, max: 1000, default: 100 } as const;

/**
 * The place a point is in (ADR 0008): every place whose centre is within its radius (the edge
 * counts), the nearest centre wins, and an exact tie goes to the oldest place (lowest id). Distances
 * are the engine's own integer haversine in decimetres, so the answer is the same on every machine.
 */
export function placeAt(point: Point, list: readonly PlaceRow[]): PlaceRow | undefined {
  let best: PlaceRow | undefined;
  let bestDm = Infinity;
  for (const p of list) {
    const dm = haversineDm(p.latE7, p.lonE7, point.latE7, point.lonE7);
    if (dm > p.radiusM * 10) continue;
    if (dm < bestDm || (dm === bestDm && best !== undefined && p.id < best.id)) {
      best = p;
      bestDm = dm;
    }
  }
  return best;
}

/**
 * The stops the engine will find for this input, where they are: stages 1, 2 and 5 of
 * `processShift` exactly (normalize, qualify, detectStops on the qualified fixes). Stop detection
 * reads no label, so these are the stops of the run that follows; a test checks it.
 */
export function detectedStopsOf(input: ShiftInput) {
  const qualified = qualify(normalize(input.fixes, input.startedAt, input.endedAt));
  return detectStops(input.shiftClientId, qualified, input.startedAt);
}

export interface PlacedInput {
  input: ShiftInput;
  /** Each detected stop inside a place, by stop key: the place's id. */
  placeOf: Map<string, number>;
  /** How many labels came from places (stops the driver had not labelled by hand). */
  placeLabels: number;
}

/**
 * Places resolved to stop labels before the engine runs (ADR 0008). A stop inside a place gets the
 * place's label unless the driver labelled it by hand: the hand label always wins. Only a shift cut
 * by stops has stops to match; the engine itself is unchanged.
 */
export function withPlaces(input: ShiftInput, list: readonly PlaceRow[]): PlacedInput {
  const placeOf = new Map<string, number>();
  if (input.segmenter !== 'stops' || list.length === 0) return { input, placeOf, placeLabels: 0 };
  const hand = new Set((input.stopLabels ?? []).map((l) => l.stopKey));
  const extra: StopLabelInput[] = [];
  for (const s of detectedStopsOf(input)) {
    const p = placeAt(s, list);
    if (!p) continue;
    placeOf.set(s.stopKey, p.id);
    if (!hand.has(s.stopKey)) extra.push({ stopKey: s.stopKey, role: p.role });
  }
  if (extra.length === 0) return { input, placeOf, placeLabels: 0 };
  return {
    input: { ...input, stopLabels: [...(input.stopLabels ?? []), ...extra] },
    placeOf,
    placeLabels: extra.length,
  };
}

/** A box around a circle in degrees x 1e7, a little larger than the circle (a first cut only). */
export function boxAround(p: Point, radiusM: number) {
  // 1e7 x degrees per metre of latitude is about 89.83; longitude shrinks with the latitude.
  const dLat = Math.ceil(radiusM * 90) + 10;
  const cos = Math.cos(((p.latE7 / 1e7) * Math.PI) / 180);
  const dLon = Math.ceil(dLat / Math.max(cos, 0.01));
  return {
    minLat: p.latE7 - dLat,
    maxLat: p.latE7 + dLat,
    minLon: p.lonE7 - dLon,
    maxLon: p.lonE7 + dLon,
  };
}

/** Whether a point is inside a circle (the edge counts), with the engine's haversine. */
export const inside = (centre: Point, radiusM: number, point: Point) =>
  haversineDm(centre.latE7, centre.lonE7, point.latE7, point.lonE7) <= radiusM * 10;
