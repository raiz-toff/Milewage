import { applyEdits } from './edits';
import { inputDigest } from './digest';
import { clockSkewFlag, detectGaps, interruptionFlags, qualityFlags, sortFlags } from './gaps';
import { gate } from './gate';
import { dmToM } from './ints';
import { normalize } from './normalize';
import { qualify } from './qualify';
import { simplifyRoute } from './route';
import { buildTrips, totalsOf, wholeShiftTrips } from './trips';
import { detectStops } from './stops';
import type { Flag, ShiftInput, ShiftResult, Stop } from './types';
import { algorithmVersion } from './version';

/**
 * The authority: batch, deterministic, no clock, no randomness (14 section 3).
 * Stages 1-4, 7 and 8 always run. Stage 5 (stops) and the stop-based segmenter run only when
 * `segmenter` is 'stops' and the shift has a stop that changes the estimate; otherwise the
 * whole-shift segmenter is used. Neither can change a total, only where trips are cut.
 */
export function processShift(input: ShiftInput): ShiftResult {
  const normalized = normalize(input.fixes, input.startedAt, input.endedAt); // 1
  const qualified = qualify(normalized); // 2
  const g = gate(qualified); // 3
  const gaps = detectGaps(g); // 4
  // 5 and 6: the segmenter slot. Stops are read from the qualified fixes, not the gated ones.
  let stops: Stop[] = [];
  const drafts = wholeShiftTrips(g.segments);
  if (input.segmenter === 'stops') {
    // M6.1: stops are recorded as facts; roles and the split arrive with M6.2.
    stops = detectStops(input.shiftClientId, qualified, input.startedAt).map((d) => ({
      stopKey: d.stopKey,
      startedAt: d.startedAt,
      endedAt: d.endedAt,
      dwellS: d.dwellS,
      latE7: d.latE7,
      lonE7: d.lonE7,
      confidence: d.confidence,
      estRole: 'none',
      role: 'none',
    }));
  }
  const built = buildTrips(input.shiftClientId, drafts);
  const edited = applyEdits(built, input.edits); // 7
  const trips = edited.trips;

  const flags: Flag[] = [
    ...gaps.flags,
    ...edited.flags,
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
    stops,
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
