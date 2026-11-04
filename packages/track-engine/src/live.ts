import { gateStep } from './gate';
import { dmToM } from './ints';
import { WINDOW_BEFORE_MS } from './normalize';
import { isQualified } from './qualify';
import type { Fix } from './types';

export interface LiveAccumulator {
  push(fix: Fix): void;
  /** Approximate running total in whole metres; shown to the driver, never stored. */
  runningTotalM(): number;
}

/**
 * Runs stages 1-3 one fix at a time with the same stage functions as the batch path.
 * Fixes are expected in time order; the shift end is unknown, so only the lower
 * window bound applies. It reads no clock: all time comes from the fixes.
 */
export function createLiveAccumulator(startedAt: number): LiveAccumulator {
  const seen = new Set<number>();
  let anchor: Fix | null = null;
  let totalDm = 0;
  return {
    push(f: Fix): void {
      if (f.recordedAt < startedAt - WINDOW_BEFORE_MS) return; // stage 1
      if (seen.has(f.seq)) return;
      seen.add(f.seq);
      if (!isQualified(f)) return; // stage 2
      const step = gateStep(anchor, f); // stage 3
      if (step.kind === 'drop') return;
      if (step.kind === 'accept') totalDm += step.distanceDm;
      anchor = f;
    },
    runningTotalM: () => dmToM(totalDm),
  };
}
