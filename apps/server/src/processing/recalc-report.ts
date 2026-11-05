import { processShift } from '@milewage/track-engine';
import { createArchiveRepository, createProcessingRepository, type Db, type ShiftRow } from '../db';
import { addTrip, buildShiftInput, type Totals } from './shift-processor';

export interface RecalcRow {
  shiftId: number;
  localDate: string;
  status: 'ended' | 'finalized';
  oldCalcVersion: number | null;
  newCalcVersion: number | null;
  old: Totals | null;
  next: Totals | null;
  /** `next - old` per figure; null when the shift was skipped. */
  diff: Totals | null;
  changed: boolean;
  /** Why the shift was not compared, if it was not. */
  skipped?: 'raw_points_archived' | 'no_stored_result';
}

const same = (a: Totals, b: Totals) =>
  a.totalM === b.totalM &&
  a.activeM === b.activeM &&
  a.deadheadM === b.deadheadM &&
  a.personalM === b.personalM;

/**
 * The comparison report of 14 section 11: what the engine of this build would give each ended or
 * finalized shift (from `since`, a local date) against what is stored. It only reads: nothing is written,
 * whatever the shift's status. Manual trips are added the way a recompute adds them, and labels are read
 * for shifts that use the stops segmenter (labels exist only when the stops module was on).
 */
export function recalcReport(db: Db, opts: { since?: string } = {}): RecalcRow[] {
  const repo = createProcessingRepository(db);
  const archive = createArchiveRepository(db);
  const rows = db
    .prepare(
      `SELECT id FROM shifts WHERE status IN ('ended','finalized') AND (? IS NULL OR local_date >= ?)
        ORDER BY started_at, id`,
    )
    .all(opts.since ?? null, opts.since ?? null) as { id: number }[];
  const out: RecalcRow[] = [];
  for (const { id } of rows) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    const base = {
      shiftId: id,
      localDate: shift.local_date as string,
      status: shift.status as 'ended' | 'finalized',
      oldCalcVersion: (shift.calc_version as number | null) ?? null,
      newCalcVersion: null,
      old: null,
      next: null,
      diff: null,
      changed: false,
    };
    if (archive.hasArchive(id)) {
      out.push({ ...base, skipped: 'raw_points_archived' });
      continue;
    }
    if (shift.total_m === null) {
      out.push({ ...base, skipped: 'no_stored_result' });
      continue;
    }
    const old: Totals = {
      totalM: shift.total_m as number,
      activeM: (shift.active_m as number | null) ?? 0,
      deadheadM: (shift.deadhead_m as number | null) ?? 0,
      personalM: (shift.personal_m as number | null) ?? 0,
    };
    const row = {
      id,
      userId: shift.user_id,
      clientId: shift.client_id,
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      segmenter: shift.segmenter,
      interruptionsJson: shift.interruptions_json,
    } as unknown as ShiftRow;
    const result = processShift(buildShiftInput(repo, row, row.segmenter === 'stops'));
    const next: Totals = { ...result.totals };
    for (const t of repo.tripsOf(id)) if (t.source === 'manual') addTrip(next, t);
    out.push({
      ...base,
      newCalcVersion: result.algorithmVersion,
      old,
      next,
      diff: {
        totalM: next.totalM - old.totalM,
        activeM: next.activeM - old.activeM,
        deadheadM: next.deadheadM - old.deadheadM,
        personalM: next.personalM - old.personalM,
      },
      changed: !same(old, next),
    });
  }
  return out;
}
