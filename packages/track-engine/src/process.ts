import { inputDigest } from './digest';
import { clockSkewFlag, detectGaps, interruptionFlags, qualityFlags, sortFlags } from './gaps';
import { gate } from './gate';
import { dmToM } from './ints';
import { normalize } from './normalize';
import { qualify } from './qualify';
import { simplifyRoute } from './route';
import { buildTrips, totalsOf, wholeShiftTrips } from './trips';
import type { Flag, ShiftInput, ShiftResult } from './types';
import { algorithmVersion } from './version';

/**
 * The authority: batch, deterministic, no clock, no randomness (14 section 3).
 * Stages 1-4, 6 (whole-shift segmenter) and 8 run here. Stage 5 (stops) and the
 * stop-based segmenter arrive with M6; until then `segmenter: 'stops'` behaves as
 * `whole_shift`, which cannot change a total. Stage 7 (edits) arrives with M1.6.
 */
export function processShift(input: ShiftInput): ShiftResult {
  const normalized = normalize(input.fixes, input.startedAt, input.endedAt); // 1
  const qualified = qualify(normalized); // 2
  const g = gate(qualified); // 3
  const gaps = detectGaps(g); // 4
  const trips = buildTrips(input.shiftClientId, wholeShiftTrips(g.segments)); // 6

  const flags: Flag[] = [
    ...gaps.flags,
    ...interruptionFlags(input.interruptions),
    ...clockSkewFlag(input.clockSkewMs),
    ...qualityFlags({
      considered: normalized.length,
      lowAccuracy: normalized.length - qualified.length,
      accepted: g.accepted.length,
      shiftMs: input.endedAt - input.startedAt,
    }),
  ];
  if (input.autoClosed) flags.push({ code: 'shift_auto_closed', at: input.endedAt });

  return {
    algorithmVersion,
    inputDigest: inputDigest(input, normalized),
    totals: totalsOf(trips),
    trips,
    stops: [],
    route: simplifyRoute(
      g.accepted.map((f) => ({ latE7: f.latE7, lonE7: f.lonE7, t: f.recordedAt })),
    ), // 8
    flags: sortFlags(flags),
    stats: {
      fixes_in: input.fixes.length,
      fixes_used: g.accepted.length,
      low_accuracy: normalized.length - qualified.length,
      non_positive_dt: g.stats.non_positive_dt,
      speed_spike: g.stats.speed_spike,
      within_gate: g.stats.within_gate,
      gap_m: dmToM(gaps.gapDm),
    },
  };
}
