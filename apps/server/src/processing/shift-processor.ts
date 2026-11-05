import { processShift, type ShiftInput, type ShiftResult } from '@milewage/track-engine';
import {
  createArchiveRepository,
  createProcessingRepository,
  type Db,
  type ShiftPatch,
  type ShiftRow,
} from '../db';
import { ProblemError } from '../errors';
import { reconcile, reconFromStored, type PhoneSummary, type Recon } from './recon';

/** Flags a driver should look at; the rest are information (14 section 8). */
const REVIEW = new Set([
  'gap_large',
  'label_orphaned',
  'override_orphaned',
  'calc_mismatch',
  'clock_skew',
]);

export interface Totals {
  totalM: number;
  activeM: number;
  deadheadM: number;
  personalM: number;
}
export function addTrip(
  t: Totals,
  x: { kind: 'active' | 'deadhead' | 'personal'; distanceM: number },
) {
  t.totalM += x.distanceM;
  if (x.kind === 'active') t.activeM += x.distanceM;
  else if (x.kind === 'deadhead') t.deadheadM += x.distanceM;
  else t.personalM += x.distanceM;
}

type ProcessingRepo = ReturnType<typeof createProcessingRepository>;

/** What the engine reads for a shift: its stored points, segmenter, interruptions, labels and overrides. */
export function buildShiftInput(
  repo: ProcessingRepo,
  shift: ShiftRow,
  withLabels: boolean,
): ShiftInput {
  const interruptions = shift.interruptionsJson
    ? (JSON.parse(shift.interruptionsJson) as { from_ms: number; to_ms: number }[])
    : [];
  return {
    shiftClientId: shift.clientId,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt ?? shift.startedAt,
    fixes: repo.fixesOf(shift.id),
    segmenter: shift.segmenter,
    stopLabels: withLabels
      ? repo.labelsOf(shift.id).map((l) => ({ stopKey: l.stopKey, role: l.role }))
      : [],
    interruptions: interruptions.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms })),
    edits: repo
      .overridesOf(shift.id)
      .map((o) => ({ tripKey: o.tripKey, kind: o.kind, purpose: o.purpose })),
  };
}

export interface PhoneReport {
  manifest?: { firstSeq: number; lastSeq: number; pointCount: number };
  result?: PhoneSummary & { segmenter: 'stops' | 'whole_shift'; tripsCount: number };
  /** The run is caused by points that arrived after the shift ended (recon reason `late_points`). */
  latePoints?: boolean;
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
  const archive = createArchiveRepository(db);
  /** The engine needs the raw points; once they are archived the stored totals and trips are all there is. */
  const assertRecomputable = (shift: ShiftRow) => {
    if (archive.hasArchive(shift.id))
      throw new ProblemError(
        'not_recomputable',
        'The raw points of this shift were archived, so it cannot be recomputed.',
      );
  };

  const inputOf = (shift: ShiftRow): ShiftInput => buildShiftInput(repo, shift, stopsOn());

  return {
    assertRecomputable,
    /**
     * Computes an ended shift and stores trips, stops, flags and totals in one transaction.
     * `phone` adds the comparison of 14 section 9.4 and the `recon_*` columns.
     */
    run(shift: ShiftRow, phone: PhoneReport = {}, extra: ShiftPatch = {}): ProcessOutcome {
      assertRecomputable(shift);
      const result = processShift(inputOf(shift));
      const t = now();
      // Manual trips (distance typed in) are kept by the write below and count in the totals (07 section 3).
      const manual = repo.tripsOf(shift.id).filter((x) => x.source === 'manual');
      const totals = { ...result.totals };
      for (const m of manual) addTrip(totals, m);
      const overrides = repo.overridesOf(shift.id);
      const editedAt = new Map(overrides.map((o) => [o.tripKey, o.editedAt]));
      // Anything the web (or a manual trip) added after the phone's own run explains a different total.
      const editedOnWeb =
        manual.length > 0 ||
        overrides.some((o) => o.deviceId === null) ||
        (stopsOn() && repo.labelsOf(shift.id).length > 0);
      const stored =
        shift.phoneTotalM !== null && shift.phoneCalcVersion !== null && shift.inputDigest !== null
          ? {
              totalM: shift.phoneTotalM,
              calcVersion: shift.phoneCalcVersion,
              inputDigest: shift.inputDigest,
            }
          : undefined;
      const recon: Recon | undefined = phone.result
        ? reconcile({
            server: result,
            phone: phone.result,
            manifest: phone.manifest,
            storedPoints: phone.manifest
              ? repo.countPoints(shift.id, phone.manifest.firstSeq, phone.manifest.lastSeq)
              : 0,
          })
        : stored &&
          reconFromStored({
            server: result,
            phone: stored,
            editedOnWeb,
            latePoints: phone.latePoints === true,
          });
      const flags = result.flags.map((f) => ({
        code: f.code,
        severity: REVIEW.has(f.code) ? ('review' as const) : ('info' as const),
        detail: JSON.stringify({ at: f.at ?? null, detail: f.detail ?? null }),
      }));
      if (manual.length > 0) {
        flags.push({
          code: 'manual_trip_present',
          severity: 'info',
          detail: JSON.stringify({ at: null, detail: String(manual.length) }),
        });
      }
      if (recon?.calcMismatch) {
        flags.push({
          code: 'calc_mismatch',
          severity: 'review',
          detail: JSON.stringify({
            at: null,
            detail: `server ${result.totals.totalM} m, phone ${phone.result?.totalM ?? stored?.totalM} m`,
          }),
        });
      }
      const patch: ShiftPatch = {
        ...extra,
        totalM: totals.totalM,
        activeM: totals.activeM,
        deadheadM: totals.deadheadM,
        personalM: totals.personalM,
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
          editedAt: editedAt.get(x.tripKey) ?? null,
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
    /**
     * Totals from the stored trips alone, with no engine run: for a shift while `tracking` is off
     * (only manual trips exist) and after a manual trip changes with no points to read.
     */
    retotal(shift: ShiftRow): ShiftRow {
      const totals = { totalM: 0, activeM: 0, deadheadM: 0, personalM: 0 };
      const all = repo.tripsOf(shift.id);
      for (const x of all) addTrip(totals, x);
      const t = now();
      const manual = all.filter((x) => x.source === 'manual').length;
      const saved = repo.writeTotals(
        { userId: shift.userId, shiftId: shift.id, now: t, manual },
        { ...totals, calculatedAt: t },
      );
      return saved ?? shift;
    },
  };
}
