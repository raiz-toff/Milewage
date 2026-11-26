import { createProcessingRepository, type Db, type ShiftRow } from '../db';
import type { MileageDeduction } from '../mileage-deduction';
import { shiftView } from '../routes/shifts';
import { createShiftChecks } from './shift-checks';

/** The `Shift` object with its flags and its deduction value, computed at read time and never stored. */
export interface ShiftPresenter {
  one(r: ShiftRow): ReturnType<typeof shiftView>;
  /** A list costs the same few queries as one shift. */
  many(rows: readonly ShiftRow[]): ReturnType<ShiftPresenter['one']>[];
}

/** Every route that returns a shift uses this. */
export function shiftPresenter(
  db: Db,
  deduction: MileageDeduction,
  now: () => number = Date.now,
): ShiftPresenter {
  const processing = createProcessingRepository(db);
  const checks = createShiftChecks({ db, now });
  const many = (rows: readonly ShiftRow[]) => {
    const flags = processing.flagsOf(rows.map((r) => r.id));
    const values = deduction.valued(rows);
    const stale = checks.stale(rows);
    return rows.map((r, i) => {
      const own = flags.get(r.id) ?? [];
      const at = stale.get(r.id);
      // Worked out now from the clock, never stored: it clears itself when a point arrives.
      const all = at
        ? [
            ...own,
            {
              id: 0,
              userId: r.userId,
              shiftId: r.id,
              code: 'stale_active_shift',
              severity: 'review' as const,
              detail: JSON.stringify({ at: at.at, detail: null }),
              createdAt: now(),
            },
          ]
        : own;
      return shiftView(r, all, values[i]);
    });
  };
  return { one: (r) => many([r])[0]!, many };
}
