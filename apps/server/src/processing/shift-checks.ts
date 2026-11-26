import { createShiftCheckRepository, createShiftRepository, type Db, type ShiftRow } from '../db';

/** A shift this short, this near and with nothing on it was most likely started by mistake. The phone and the web use the same numbers. */
export const VERY_SHORT_MS = 120_000;
export const VERY_SHORT_M = 160;
/** An active shift with no recorded point for this long is stale (a dead battery, a forgotten stop). */
export const STALE_ACTIVE_MS = 12 * 3_600_000;

const detail = (text: string | null) => JSON.stringify({ at: null, detail: text });

/**
 * The flags no engine run derives and a run would wipe: `very_short_shift` (info) and
 * `shift_overlap` (review, with `shifts.overlaps_shift_id`). Flag, never refuse: nothing here
 * rejects a shift the phone sent. `stale_active_shift` is worked out at read time, never stored.
 */
export function createShiftChecks({ db, now }: { db: Db; now: () => number }) {
  const repo = createShiftCheckRepository(db);
  const shifts = createShiftRepository(db);

  /** Finds the shift this one overlaps (end equal to a start is not an overlap), stores it and sets or clears the flag. */
  const overlap = (row: ShiftRow) => {
    const t = now();
    const end = row.status === 'active' ? t : (row.endedAt ?? row.startedAt);
    const other = repo.overlapping(row.userId, row.id, row.startedAt, end, t);
    repo.setOverlap(row.id, other ?? null);
    repo.setFlag(
      { userId: row.userId, shiftId: row.id, code: 'shift_overlap', severity: 'review', now: t },
      other === undefined ? undefined : detail(String(other)),
    );
  };

  /** The rule behind `very_short_shift`: under 2 minutes, under 160 m, nothing on it. A phone may delete only such a shift. */
  const verySmall = (row: ShiftRow) =>
    row.status !== 'active' &&
    row.endedAt !== null &&
    row.endedAt - row.startedAt < VERY_SHORT_MS &&
    (row.totalM ?? 0) < VERY_SHORT_M &&
    !repo.hasContent(row.id);

  return {
    isVeryShort: verySmall,
    /** After a shift was started, ended, retimed, recomputed or finalized: its own flags, and those of the shifts that named it. */
    settle(row: ShiftRow): ShiftRow {
      const named = repo.overlappedBy(row.id);
      const fresh = shifts.byId(row.id) ?? row;
      overlap(fresh);
      for (const id of named) {
        const o = shifts.byId(id);
        if (o) overlap(o);
      }
      repo.setFlag(
        {
          userId: row.userId,
          shiftId: row.id,
          code: 'very_short_shift',
          severity: 'info',
          now: now(),
        },
        verySmall(fresh) ? detail(null) : undefined,
      );
      return shifts.byId(row.id) ?? row;
    },
    /** After a shift was deleted: the shifts that named it look again for another overlap. */
    afterPurge(named: readonly number[]) {
      for (const id of named) {
        const o = shifts.byId(id);
        if (o) overlap(o);
      }
    },
    named: (shiftId: number) => repo.overlappedBy(shiftId),
    /** The review flag of a running shift with nothing recorded for 12 hours, from the clock; null when it is fine. */
    stale(rows: readonly ShiftRow[]): Map<number, { at: number | null }> {
      const t = now();
      const out = new Map<number, { at: number | null }>();
      for (const r of rows) {
        if (r.status !== 'active') continue;
        const last = repo.lastPointAt(r.id);
        if (t - (last ?? r.startedAt) >= STALE_ACTIVE_MS) out.set(r.id, { at: last ?? null });
      }
      return out;
    },
  };
}
