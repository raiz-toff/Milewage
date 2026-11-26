import type { Db } from './open';

/** What the shift checks (very short, overlap, stale) read and write; plain SQL on a few small tables. */
export function createShiftCheckRepository(db: Db) {
  const has = (table: string) =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined;
  const exists = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) !== undefined;
  return {
    /** Another shift of the user that overlaps `[start, end)`: it starts before `end` and ends after `start`. A running one ends `now`. */
    overlapping(
      userId: number,
      shiftId: number,
      start: number,
      end: number,
      now: number,
    ): number | undefined {
      const r = db
        .prepare(
          `SELECT id FROM shifts
            WHERE user_id = ? AND id <> ? AND started_at < ? AND coalesce(ended_at, ?) > ?
            ORDER BY started_at, id LIMIT 1`,
        )
        .get(userId, shiftId, end, now, start) as { id: number } | undefined;
      return r?.id;
    },
    /** Shifts that name `shiftId` as the one they overlap. */
    overlappedBy: (shiftId: number): number[] =>
      (
        db.prepare('SELECT id FROM shifts WHERE overlaps_shift_id = ?').all(shiftId) as {
          id: number;
        }[]
      ).map((r) => r.id),
    setOverlap(shiftId: number, otherId: number | null) {
      db.prepare('UPDATE shifts SET overlaps_shift_id = ? WHERE id = ?').run(otherId, shiftId);
    },
    /** Earnings, labelled payouts, parking and tolls (expenses on the shift) or a manual trip: the shift is not trivial. */
    hasContent(shiftId: number): boolean {
      if (
        has('shift_earnings') &&
        exists('SELECT 1 FROM shift_earnings WHERE shift_id = ?', shiftId)
      )
        return true;
      if (
        has('stop_labels') &&
        exists(
          'SELECT 1 FROM stop_labels WHERE shift_id = ? AND (payout_cents > 0 OR tip_cents > 0)',
          shiftId,
        )
      )
        return true;
      if (has('expenses') && exists('SELECT 1 FROM expenses WHERE shift_id = ?', shiftId))
        return true;
      return exists("SELECT 1 FROM trips WHERE shift_id = ? AND source = 'manual'", shiftId);
    },
    /** The time of the newest stored point of a shift, or undefined with none (or no tracking tables). */
    lastPointAt(shiftId: number): number | undefined {
      if (!has('telemetry_points')) return undefined;
      const r = db
        .prepare('SELECT max(recorded_at) AS at FROM telemetry_points WHERE shift_id = ?')
        .get(shiftId) as { at: number | null };
      return r.at ?? undefined;
    },
    /** One flag per code: replaces it, or removes it when `detail` is undefined. */
    setFlag(
      f: {
        userId: number;
        shiftId: number;
        code: string;
        severity: 'info' | 'review';
        now: number;
      },
      detail: string | undefined,
    ) {
      db.prepare('DELETE FROM shift_flags WHERE shift_id = ? AND code = ?').run(f.shiftId, f.code);
      if (detail !== undefined)
        db.prepare(
          'INSERT INTO shift_flags (user_id, shift_id, code, severity, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(f.userId, f.shiftId, f.code, f.severity, detail, f.now);
    },
  };
}
