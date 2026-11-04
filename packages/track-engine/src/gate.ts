import { haversineDm } from './haversine';
import { dmToM } from './ints';
import { normalize } from './normalize';
import { qualify } from './qualify';
import type { Fix } from './types';

/** Implied speed above this is a glitch: 42 m/s = 420 dm/s (14 section 5.3). */
export const MAX_SPEED_DMPS = 420;
/** Movement under this from the anchor is not counted: 20 m = 200 dm. */
export const MIN_MOVE_DM = 200;

export type DropReason = 'non_positive_dt' | 'speed_spike' | 'within_gate';

export type GateStep =
  | { kind: 'anchor' }
  | { kind: 'accept'; distanceDm: number }
  | { kind: 'drop'; reason: DropReason };

/**
 * Stage 3 for one fix. `anchor` is the last accepted fix (null before the first).
 * The anchor only moves on accept; the caller sets it.
 */
export function gateStep(anchor: Fix | null, f: Fix): GateStep {
  if (anchor === null) return { kind: 'anchor' };
  const dtMs = f.recordedAt - anchor.recordedAt;
  if (dtMs <= 0) return { kind: 'drop', reason: 'non_positive_dt' };
  const dDm = haversineDm(anchor.latE7, anchor.lonE7, f.latE7, f.lonE7);
  if (dDm * 1000 > MAX_SPEED_DMPS * dtMs) return { kind: 'drop', reason: 'speed_spike' };
  if (dDm < MIN_MOVE_DM) return { kind: 'drop', reason: 'within_gate' };
  return { kind: 'accept', distanceDm: dDm };
}

/** One accepted step between consecutive accepted fixes. */
export interface Segment {
  from: Fix;
  to: Fix;
  distanceDm: number;
  /** Time from the previous plausible fix (accepted or inside the 20 m gate) to `to`. */
  silenceMs: number;
}

/** A fix dropped as a speed spike, with the anchor it was measured against. */
export interface Spike {
  fix: Fix;
  anchor: Fix;
  distanceDm: number;
  silenceMs: number;
}

export interface GateResult {
  accepted: Fix[];
  segments: Segment[];
  spikes: Spike[];
  distanceDm: number;
  distanceM: number;
  stats: { non_positive_dt: number; speed_spike: number; within_gate: number };
}

/** Stage 3 over already normalized and qualified fixes. */
export function gate(fixes: readonly Fix[]): GateResult {
  const accepted: Fix[] = [];
  const segments: Segment[] = [];
  const spikes: Spike[] = [];
  const stats = { non_positive_dt: 0, speed_spike: 0, within_gate: 0 };
  let anchor: Fix | null = null;
  let prevAt = 0; // time of the previous plausible fix; glitches do not count as signal
  let distanceDm = 0;
  for (const f of fixes) {
    const step = gateStep(anchor, f);
    if (step.kind === 'drop') {
      stats[step.reason]++;
      if (step.reason === 'within_gate') prevAt = f.recordedAt;
      if (step.reason === 'speed_spike' && anchor !== null) {
        spikes.push({
          fix: f,
          anchor,
          distanceDm: haversineDm(anchor.latE7, anchor.lonE7, f.latE7, f.lonE7),
          silenceMs: f.recordedAt - prevAt,
        });
      }
      continue;
    }
    if (step.kind === 'accept' && anchor !== null) {
      distanceDm += step.distanceDm;
      segments.push({
        from: anchor,
        to: f,
        distanceDm: step.distanceDm,
        silenceMs: f.recordedAt - prevAt,
      });
    }
    anchor = f;
    prevAt = f.recordedAt;
    accepted.push(f);
  }
  return { accepted, segments, spikes, distanceDm, distanceM: dmToM(distanceDm), stats };
}

/** Stages 1-3 in batch: the distance part of the engine. */
export function measureDistance(fixes: readonly Fix[], startedAt: number, endedAt: number) {
  return gate(qualify(normalize(fixes, startedAt, endedAt)));
}
