import { processShift, type ShiftInput, type ShiftResult } from '@milewage/track-engine';
import { createProcessingRepository, type Db, type ShiftPatch, type ShiftRow } from '../db';
import { reconcile, type PhoneSummary, type Recon } from './recon';

/** Flags a driver should look at; the rest are information (14 section 8). */
const REVIEW = new Set([
  'gap_large',
  'label_orphaned',
  'override_orphaned',
  'calc_mismatch',
  'clock_skew',
]);

export interface PhoneReport {
  manifest?: { firstSeq: number; lastSeq: number; pointCount: number };
  result?: PhoneSummary & { segmenter: 'stops' | 'whole_shift'; tripsCount: number };
}

export interface ProcessOutcome {
  shift: ShiftRow;
  result: ShiftResult;
  /** Present only when the phone sent its result. */
  recon?: Recon;
}

export interface ShiftProcessorOptions {
  db: Db;
  now: () => number;
  /** Whether the `stops` module is on; stops and labels are only read and written then. */
  stopsOn: () => boolean;
}

export type ShiftProcessor = ReturnType<typeof createShiftProcessor>;

/**
 * Runs the shared engine on the points the server stores and stores its result (08 section 4.4,
 * 14 section 9.4). The server's result is the one that counts. The segmenter is the one captured at
 * shift start, never the current setting.
 */
export function createShiftProcessor({ db, now, stopsOn }: ShiftProcessorOptions) {
  const repo = createProcessingRepository(db);

  const inputOf = (shift: ShiftRow): ShiftInput => {
    const interruptions = shift.interruptionsJson
      ? (JSON.parse(shift.interruptionsJson) as { from_ms: number; to_ms: number }[])
      : [];
    return {
      shiftClientId: shift.clientId,
      startedAt: shift.startedAt,
      endedAt: shift.endedAt ?? shift.startedAt,
      fixes: repo.fixesOf(shift.id),
      segmenter: shift.segmenter,
      stopLabels: stopsOn()
        ? repo.labelsOf(shift.id).map((l) => ({ stopKey: l.stopKey, role: l.role }))
        : [],
      interruptions: interruptions.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms })),
    };
  };

  return {
    /**
     * Computes an ended shift and stores trips, stops, flags and totals in one transaction.
     * `phone` adds the comparison of 14 section 9.4 and the `recon_*` columns.
     */
    run(shift: ShiftRow, phone: PhoneReport = {}, extra: ShiftPatch = {}): ProcessOutcome {
      const result = processShift(inputOf(shift));
      const t = now();
      const recon =
        phone.result &&
        reconcile({
          server: result,
          phone: phone.result,
          manifest: phone.manifest,
          storedPoints: phone.manifest
            ? repo.countPoints(shift.id, phone.manifest.firstSeq, phone.manifest.lastSeq)
            : 0,
        });
      const flags = result.flags.map((f) => ({
        code: f.code,
        severity: REVIEW.has(f.code) ? ('review' as const) : ('info' as const),
        detail: JSON.stringify({ at: f.at ?? null, detail: f.detail ?? null }),
      }));
      if (recon?.calcMismatch) {
        flags.push({
          code: 'calc_mismatch',
          severity: 'review',
          detail: JSON.stringify({
            at: null,
            detail: `server ${result.totals.totalM} m, phone ${phone.result?.totalM} m`,
          }),
        });
      }
      const patch: ShiftPatch = {
        ...extra,
        totalM: result.totals.totalM,
        activeM: result.totals.activeM,
        deadheadM: result.totals.deadheadM,
        personalM: result.totals.personalM,
        calcVersion: result.algorithmVersion,
        calculatedAt: t,
        ...(recon
          ? {
              reconStatus: recon.status,
              reconReasons: JSON.stringify(recon.reasons),
              calcMismatch: recon.calcMismatch ? 1 : 0,
            }
          : {}),
      };
      const saved = repo.writeDerived({
        userId: shift.userId,
        shiftId: shift.id,
        now: t,
        shift: patch,
        trips: result.trips.map((x) => ({
          tripKey: x.tripKey,
          kind: x.kind,
          originalKind: x.originalKind,
          startedAt: x.startedAt,
          endedAt: x.endedAt,
          startLatE7: x.startLatE7,
          startLonE7: x.startLonE7,
          endLatE7: x.endLatE7,
          endLonE7: x.endLonE7,
          distanceM: x.distanceM,
          purpose: x.purpose,
          editedAt: null,
        })),
        flags,
        stops: stopsOn()
          ? result.stops.map((s) => ({
              stopKey: s.stopKey,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              dwellS: s.dwellS,
              latE7: s.latE7,
              lonE7: s.lonE7,
              confidence: s.confidence,
              estRole: s.estRole,
              role: s.role,
            }))
          : undefined,
      });
      return { shift: saved ?? shift, result, recon };
    },
  };
}
