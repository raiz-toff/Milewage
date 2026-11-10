import type { Segment } from './gate';
import { haversineDm } from './haversine';
import type { TripDraft } from './trips';
import type { Fix, Flag, Stop, StopLabelInput } from './types';

// Stage 5 (stop detection) and the estimate of stage 6 (14 section 6). Everything here is
// integer arithmetic on the same decimetre haversine as the gate. Nothing in this file reads
// an accepted-fix distance for a total: stops only decide where a trip is cut.
//
// ALL THE CONSTANTS BELOW ARE DOCUMENTED GUESSES (14 sections 12 and 16 D16). They come from
// the spec's reasoning about a Toronto scooter, not from measurement. Spike A13 / experiments
// E9 and E10 measure them against the delivery platform's order history; until that run
// passes, treat every stop and every active/deadhead split as unvalidated. Changing any value
// is an `algorithmVersion` bump.

/** A fix belongs to a dwell within 40 m of the dwell's anchor. Guess: above parked jitter, below a block. */
export const STOP_RADIUS_DM = 400;
/** A cluster shorter than 120 s is not a stop (traffic lights, brief pauses). Guess (E9: 90 / 150 s). */
export const STOP_MIN_DWELL_MS = 120_000;
/** An unlabelled stop must last at least 180 s to change the estimate. Guess (E10: 150 / 240 s). */
export const STOP_TOGGLE_DWELL_MS = 180_000;
/** A stop of 30 minutes or more is a break or long wait: flagged `long_stop`, never changes the estimate. Guess. */
export const STOP_BREAK_DWELL_MS = 1_800_000;
/** Confidence from dwell only: medium from 180 s, high from 600 s (14 section 6.5). Guess. */
export const STOP_MEDIUM_DWELL_MS = 180_000;
export const STOP_HIGH_DWELL_MS = 600_000;
/** Wake-up rule: GPS sleeps after 150 s of stillness, so a fix after a gap of 90 s or more within 150 m is the dwell's last member. Guess. */
export const STOP_WAKE_GAP_MS = 90_000;
export const STOP_WAKE_RADIUS_DM = 1_500;
/** Merge rule: two stops with anchors within 100 m and under 120 s between them are one stop (walk to the door and back). Guess. */
export const STOP_MERGE_RADIUS_DM = 1_000;
export const STOP_MERGE_RIDE_MS = 120_000;
/** Start guard: a stop starting within 5 min of the shift start and within 150 m of its first fix is not a pickup. Guess. */
export const STOP_START_GUARD_MS = 300_000;
export const STOP_START_GUARD_RADIUS_DM = 1_500;

export type Confidence = Stop['confidence'];

export function stopConfidence(dwellMs: number): Confidence {
  return dwellMs >= STOP_HIGH_DWELL_MS
    ? 'high'
    : dwellMs >= STOP_MEDIUM_DWELL_MS
      ? 'medium'
      : 'low';
}

/** `<shift client_id>:<anchor recordedAt ms>:stop`, the same string on phone and server (14 section 6.2). */
export function makeStopKey(shiftClientId: string, anchorAt: number): string {
  return `${shiftClientId}:${anchorAt}:stop`;
}

/** A detected stop before roles. `startGuarded` stops never change the estimate. */
export interface DetectedStop {
  stopKey: string;
  startedAt: number;
  endedAt: number;
  dwellS: number;
  latE7: number;
  lonE7: number;
  confidence: Confidence;
  startGuarded: boolean;
}

function dist(a: { latE7: number; lonE7: number }, b: { latE7: number; lonE7: number }): number {
  return haversineDm(a.latE7, a.lonE7, b.latE7, b.lonE7);
}

/**
 * Stage 5. `qualified` is the stage 2 output (sorted, de-duplicated, accuracy at most 50 m),
 * BEFORE the gate (stage 3): the gate drops the fixes inside a dwell, so it cannot be the input.
 * Nothing here reads the gate's minimum move.
 * One left-to-right scan; a cluster only looks ahead over fixes inside the radius.
 */
export function detectStops(
  shiftClientId: string,
  qualified: readonly Fix[],
  shiftStartedAt: number,
): DetectedStop[] {
  const n = qualified.length;
  const raw: { anchor: Fix; endedAt: number }[] = [];
  let i = 0;
  while (i < n) {
    const anchor = qualified[i]!;
    let j = i;
    while (j + 1 < n && dist(anchor, qualified[j + 1]!) <= STOP_RADIUS_DM) j++;
    // Wake-up rule: the first fix after the cluster, after a long gap, still close by.
    const next = qualified[j + 1];
    if (
      next !== undefined &&
      next.recordedAt - qualified[j]!.recordedAt >= STOP_WAKE_GAP_MS &&
      dist(anchor, next) <= STOP_WAKE_RADIUS_DM
    ) {
      j++;
    }
    const endedAt = qualified[j]!.recordedAt;
    if (endedAt - anchor.recordedAt >= STOP_MIN_DWELL_MS) {
      raw.push({ anchor, endedAt });
      i = j + 1;
    } else {
      i++;
    }
  }

  // Merge rule, folding left so a chain of close stops becomes one.
  const merged: { anchor: Fix; endedAt: number }[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      s.anchor.recordedAt - prev.endedAt < STOP_MERGE_RIDE_MS &&
      dist(prev.anchor, s.anchor) <= STOP_MERGE_RADIUS_DM
    ) {
      prev.endedAt = s.endedAt;
    } else {
      merged.push({ anchor: s.anchor, endedAt: s.endedAt });
    }
  }

  const first = qualified[0];
  return merged.map(({ anchor, endedAt }) => {
    const dwellMs = endedAt - anchor.recordedAt;
    return {
      stopKey: makeStopKey(shiftClientId, anchor.recordedAt),
      startedAt: anchor.recordedAt,
      endedAt,
      dwellS: Math.floor(dwellMs / 1000),
      latE7: anchor.latE7,
      lonE7: anchor.lonE7,
      confidence: stopConfidence(dwellMs),
      startGuarded:
        first !== undefined &&
        anchor.recordedAt - shiftStartedAt <= STOP_START_GUARD_MS &&
        dist(first, anchor) <= STOP_START_GUARD_RADIUS_DM,
    };
  });
}

export type TripState = 'active' | 'deadhead';

export interface RoleResult {
  stops: Stop[];
  flags: Flag[];
  /** State changes in time order: from `at` (a stop's departure) the state is `state`. */
  changes: { at: number; state: TripState }[];
}

/**
 * Stage 6, the estimate (14 section 6.3). State starts as deadhead. A driver label wins:
 * pickup sets active, dropoff sets deadhead, other changes nothing. An unlabelled stop of
 * 180 s up to (not including) 30 min, not start-guarded, flips the state. `estRole` is what
 * the engine would say in the state in force at that stop; `role` is the label if any, else
 * `estRole`. A label whose stop no longer exists is returned as `label_orphaned`.
 */
export function estimateRoles(
  detected: readonly DetectedStop[],
  labels: readonly StopLabelInput[] | undefined,
): RoleResult {
  const byKey = new Map<string, StopLabelInput['role']>();
  const sorted = [...(labels ?? [])].sort((a, b) =>
    a.stopKey < b.stopKey
      ? -1
      : a.stopKey > b.stopKey
        ? 1
        : a.role < b.role
          ? -1
          : a.role > b.role
            ? 1
            : 0,
  );
  for (const l of sorted) byKey.set(l.stopKey, l.role); // later in sorted order wins
  const flags: Flag[] = [];
  const stops: Stop[] = [];
  const changes: RoleResult['changes'] = [];
  let state: TripState = 'deadhead';
  const known = new Set<string>();
  for (const d of detected) {
    known.add(d.stopKey);
    const dwellMs = d.endedAt - d.startedAt;
    const flips =
      !d.startGuarded && dwellMs >= STOP_TOGGLE_DWELL_MS && dwellMs < STOP_BREAK_DWELL_MS;
    const estRole: Stop['estRole'] = !flips ? 'none' : state === 'deadhead' ? 'pickup' : 'dropoff';
    const label = byKey.get(d.stopKey);
    const role: Stop['role'] = label ?? estRole;
    if (dwellMs >= STOP_BREAK_DWELL_MS)
      flags.push({ code: 'long_stop', at: d.startedAt, detail: d.stopKey });
    const next: TripState | null =
      role === 'pickup' ? 'active' : role === 'dropoff' ? 'deadhead' : null;
    if (next !== null && next !== state) {
      state = next;
      changes.push({ at: d.endedAt, state });
    }
    stops.push({
      stopKey: d.stopKey,
      startedAt: d.startedAt,
      endedAt: d.endedAt,
      dwellS: d.dwellS,
      latE7: d.latE7,
      lonE7: d.lonE7,
      confidence: d.confidence,
      estRole,
      role,
    });
  }
  for (const [stopKey] of byKey) {
    if (!known.has(stopKey)) flags.push({ code: 'label_orphaned', detail: stopKey });
  }
  return { stops, flags, changes };
}

export const ESTIMATED_PURPOSE: Record<TripState, string> = {
  active: 'Delivery (estimated)',
  deadhead: 'Between deliveries (estimated)',
};

/**
 * The stop-based segmenter (the segmenter slot). Each accepted segment takes the state in
 * force at its END time; a state starts at the stop's departure, so a segment ending exactly
 * at `endedAt` (the wake-up fix) already belongs to the new state. Cuts happen only where
 * the state changes, and distance is only partitioned, never altered.
 */
export function stopTrips(
  segments: readonly Segment[],
  changes: RoleResult['changes'],
): TripDraft[] {
  const drafts: TripDraft[] = [];
  let state: TripState = 'deadhead';
  let c = 0;
  let cur: TripDraft | null = null;
  for (const s of segments) {
    while (c < changes.length && changes[c]!.at <= s.to.recordedAt) state = changes[c++]!.state;
    if (cur === null || cur.originalKind !== state) {
      cur = {
        originalKind: state,
        startedAt: s.from.recordedAt,
        endedAt: s.to.recordedAt,
        startLatE7: s.from.latE7,
        startLonE7: s.from.lonE7,
        endLatE7: s.to.latE7,
        endLonE7: s.to.lonE7,
        distanceDm: 0,
        purpose: ESTIMATED_PURPOSE[state],
      };
      drafts.push(cur);
    }
    cur.endedAt = s.to.recordedAt;
    cur.endLatE7 = s.to.latE7;
    cur.endLonE7 = s.to.lonE7;
    cur.distanceDm += s.distanceDm;
  }
  return drafts;
}
