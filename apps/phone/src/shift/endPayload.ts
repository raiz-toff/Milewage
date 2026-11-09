import { processShift, type Fix, type ShiftResult } from '@milewage/track-engine';
import type { Manifest, PhoneTotals } from '../sync/shiftRequests';
import type { Tracker } from '../tracker/types';
import { PUMP_LIMIT, toFix } from './feed';

export interface EndShiftInfo {
  clientId: string;
  startedAt: number;
  endedAt: number;
  segmenter: 'stops' | 'whole_shift';
}

/** Every stored row of a shift (PENDING and UPLOADED), in seq order. */
export function readAllRows(tracker: Tracker, clientId: string) {
  const rows = [];
  let after = 0;
  for (;;) {
    const page = tracker.readByShift(clientId, after, PUMP_LIMIT);
    rows.push(...page);
    const last = page[page.length - 1];
    if (!last || page.length < PUMP_LIMIT) return rows;
    after = last.seq;
  }
}

export interface LocalRun {
  result: ShiftResult;
  /** The additive `shift.end` facts of 08 section 4.4 / 14 section 9.3. */
  manifest: Manifest;
  phoneResult: PhoneTotals;
}

/**
 * Runs the shared engine over every stored row of the shift (PENDING, UPLOADED, never the
 * quarantined ones) and builds the manifest and the phone's result for `shift.end` (15 section 5,
 * 6.1). It runs at shift end, offline, before anything is uploaded; points the server later
 * refuses show up as `points_missing` in the reconciliation, which is what that reason is for.
 *
 * Returns null for a shift without stored points and when the engine throws: ending the shift
 * never depends on the engine (the server calculates, the phone shows "Totals will appear after
 * sync"). Not sent: `interruptions` (the native recovery path does not write them yet).
 */
export function runLocal(tracker: Tracker, shift: EndShiftInfo): LocalRun | null {
  try {
    const rows = readAllRows(tracker, shift.clientId);
    if (rows.length === 0) return null;
    const fixes: Fix[] = rows.map(toFix);
    const r = processShift({
      shiftClientId: shift.clientId,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      fixes,
      segmenter: shift.segmenter,
    });
    const first = rows[0]!.seq;
    const last = rows[rows.length - 1]!.seq;
    return {
      result: r,
      manifest: { firstSeq: first, lastSeq: last, pointCount: rows.length },
      phoneResult: {
        calcVersion: r.algorithmVersion,
        segmenter: shift.segmenter,
        inputDigest: r.inputDigest,
        totalM: r.totals.totalM,
        activeM: r.totals.activeM,
        deadheadM: r.totals.deadheadM,
        personalM: r.totals.personalM,
        tripsCount: r.trips.length,
      },
    };
  } catch {
    return null;
  }
}
