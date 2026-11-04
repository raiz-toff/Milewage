import { processShift, type Fix } from '@milewage/track-engine';
import type { components } from '@milewage/shared/generated/api-types';
import type { Tracker } from '../tracker/types';
import { PUMP_LIMIT, toFix } from './feed';

type Schemas = components['schemas'];

/** The additive `shift.end` fields of 08 section 4.4 / 14 section 9.3, typed from the OpenAPI file. */
export interface EndExtras {
  manifest?: Schemas['PointManifest'];
  phone_result?: Schemas['PhoneResult'];
}

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

/**
 * Builds the manifest and the phone's result for `shift.end`. Runs after the upload barrier, so
 * the rows read here are the ones the server has. Points the server quarantined are no longer in
 * the buffer and so are in neither the manifest nor the digest; the server did not keep them
 * either, so the two sides agree on the same set.
 *
 * Not sent: `interruptions` (they come from the native recovery path, which does not write them
 * yet) and the clock-skew input. A shift without stored points sends neither field. Any engine
 * failure sends nothing extra: ending the shift never depends on the engine.
 */
export function buildEndExtras(tracker: Tracker, shift: EndShiftInfo): EndExtras {
  try {
    const rows = readAllRows(tracker, shift.clientId);
    if (rows.length === 0) return {};
    const fixes: Fix[] = rows.map(toFix);
    const r = processShift({
      shiftClientId: shift.clientId,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt,
      fixes,
      segmenter: shift.segmenter,
    });
    return {
      manifest: {
        first_seq: rows[0]!.seq,
        last_seq: rows[rows.length - 1]!.seq,
        point_count: rows.length,
      },
      phone_result: {
        calc_version: r.algorithmVersion,
        segmenter: shift.segmenter,
        input_digest: r.inputDigest,
        total_m: r.totals.totalM,
        active_m: r.totals.activeM,
        deadhead_m: r.totals.deadheadM,
        personal_m: r.totals.personalM,
        trips_count: r.trips.length,
      },
    };
  } catch {
    return {};
  }
}
