import { createProcessingRepository, type Db, type ShiftRow } from '../db';
import type { MileageDeduction } from '../mileage-deduction';
import { shiftView } from '../routes/shifts';

/** The `Shift` object with its flags and its deduction value, computed at read time and never stored. */
export interface ShiftPresenter {
  one(r: ShiftRow): ReturnType<typeof shiftView>;
  /** A list costs the same few queries as one shift. */
  many(rows: readonly ShiftRow[]): ReturnType<ShiftPresenter['one']>[];
}

/** Every route that returns a shift uses this. */
export function shiftPresenter(db: Db, deduction: MileageDeduction): ShiftPresenter {
  const processing = createProcessingRepository(db);
  const many = (rows: readonly ShiftRow[]) => {
    const flags = processing.flagsOf(rows.map((r) => r.id));
    const cents = deduction.ofShifts(rows);
    return rows.map((r, i) => shiftView(r, flags.get(r.id), cents[i] ?? null));
  };
  return { one: (r) => many([r])[0]!, many };
}
