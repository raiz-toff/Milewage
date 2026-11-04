import type { Segment } from './gate';
import { dmToM } from './ints';
import type { Trip } from './types';

/** A trip before output rounding: distance in decimetres, state at its start. */
export interface TripDraft {
  originalKind: 'active' | 'deadhead';
  startedAt: number;
  endedAt: number;
  startLatE7: number;
  startLonE7: number;
  endLatE7: number;
  endLonE7: number;
  distanceDm: number;
  purpose: string;
}

/** Purpose of the single trip when the whole-shift segmenter is used (14 section 6.1). */
export const WHOLE_SHIFT_PURPOSE = 'Business driving';

/**
 * Deterministic trip identity (14 section 6.7): `<shift client_id>:<segment start epoch ms>:<original_kind>`.
 * The same string on phone and server; driver edits are stored against it.
 */
export function makeTripKey(
  shiftClientId: string,
  startedAt: number,
  originalKind: 'active' | 'deadhead',
): string {
  return `${shiftClientId}:${startedAt}:${originalKind}`;
}

/**
 * The whole-shift segmenter (the segmenter slot, 14 section 17): every accepted segment
 * belongs to one `active` trip. No accepted segment means no trip.
 */
export function wholeShiftTrips(segments: readonly Segment[]): TripDraft[] {
  if (segments.length === 0) return [];
  const first = segments[0]!.from;
  const last = segments[segments.length - 1]!.to;
  let distanceDm = 0;
  for (const s of segments) distanceDm += s.distanceDm;
  return [
    {
      originalKind: 'active',
      startedAt: first.recordedAt,
      endedAt: last.recordedAt,
      startLatE7: first.latE7,
      startLonE7: first.lonE7,
      endLatE7: last.latE7,
      endLonE7: last.lonE7,
      distanceDm,
      purpose: WHOLE_SHIFT_PURPOSE,
    },
  ];
}

/**
 * Turns drafts into trips with whole-metre distances that add up to the rounded total
 * exactly: each trip gets round(cumulative dm / 10) minus the previous cumulative figure,
 * so metres are rounded once overall and never drift (14 section 9.1 rule 2).
 */
export function buildTrips(shiftClientId: string, drafts: readonly TripDraft[]): Trip[] {
  const trips: Trip[] = [];
  let cumDm = 0;
  let prevM = 0;
  for (const d of drafts) {
    cumDm += d.distanceDm;
    const cumM = dmToM(cumDm);
    trips.push({
      tripKey: makeTripKey(shiftClientId, d.startedAt, d.originalKind),
      kind: d.originalKind,
      originalKind: d.originalKind,
      startedAt: d.startedAt,
      endedAt: d.endedAt,
      startLatE7: d.startLatE7,
      startLonE7: d.startLonE7,
      endLatE7: d.endLatE7,
      endLonE7: d.endLonE7,
      distanceM: cumM - prevM,
      purpose: d.purpose,
    });
    prevM = cumM;
  }
  return trips;
}

export function totalsOf(trips: readonly Trip[]): {
  totalM: number;
  activeM: number;
  deadheadM: number;
  personalM: number;
} {
  const t = { totalM: 0, activeM: 0, deadheadM: 0, personalM: 0 };
  for (const trip of trips) {
    t.totalM += trip.distanceM;
    if (trip.kind === 'active') t.activeM += trip.distanceM;
    else if (trip.kind === 'deadhead') t.deadheadM += trip.distanceM;
    else t.personalM += trip.distanceM;
  }
  return t;
}
