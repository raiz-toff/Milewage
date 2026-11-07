import { countryModules, mileageDeduction, periodStart, type VehicleKind } from '@milewage/shared';
import {
  createProcessingRepository,
  createSettingsRepository,
  createVehicleRepository,
  type Db,
  type ShiftRow,
} from '../db';
import { deductionMethodFor } from '../deduction-method';
import { shiftView } from '../routes/shifts';

/**
 * Deduction value of one shift in cents (07 section 3): computed at read time from `total_m` and the pack
 * of the owner's country for the shift's date, with the business metres already driven in the same
 * rate period (calendar or tax year) so tiered rates split correctly. Never stored.
 */
export function deductionOfShift(db: Db, r: ShiftRow): number | null {
  if (r.totalM === null || r.status === 'active') return null;
  const country = createSettingsRepository(db).get(r.userId)?.country;
  const pack = country ? countryModules.get(country) : undefined;
  if (!pack) return null;
  // A vehicle deducted through its expenses has no mileage deduction value (18 section 7.1).
  if (
    deductionMethodFor(db, r.userId, r.vehicleId, Number(r.localDate.slice(0, 4))) ===
    'actual_expenses'
  )
    return null;
  const kind = createVehicleRepository(db).find(r.userId, r.vehicleId)?.kind ?? 'car';
  const prior = db
    .prepare(
      `SELECT coalesce(sum(s.total_m), 0) FROM shifts s JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.user_id = ? AND s.status IN ('ended','finalized') AND v.kind = ?
          AND s.local_date >= ?
          AND (s.local_date < ? OR (s.local_date = ? AND (s.started_at < ? OR (s.started_at = ? AND s.id < ?))))`,
    )
    .pluck()
    .get(
      r.userId,
      kind,
      periodStart(pack.mileage, r.localDate),
      r.localDate,
      r.localDate,
      r.startedAt,
      r.startedAt,
      r.id,
    ) as number;
  return mileageDeduction(pack, {
    totalM: r.totalM,
    priorM: prior,
    date: r.localDate,
    vehicleKind: kind as VehicleKind,
  });
}

/** The `Shift` object with its flags and its deduction value. Every route that returns a shift uses this. */
export function presentShift(db: Db, r: ShiftRow) {
  return presentShifts(db, [r])[0]!;
}
export function presentShifts(db: Db, rows: readonly ShiftRow[]) {
  const flags = createProcessingRepository(db).flagsOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...shiftView(r, flags.get(r.id)),
    deduction_cents: deductionOfShift(db, r),
  }));
}
