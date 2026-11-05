import { expenseCategory, notAutomobile } from '@milewage/shared';
import { createVehicleRepository, type Db, type ExpenseRow } from './db';
import { deductionMethodFor } from './deduction-method';

/** Round half up, in cents (18 section 5.2). Computed at read time, never stored. */
export const deductibleCents = (
  e: Pick<ExpenseRow, 'amountCents' | 'businessPct' | 'deductible'>,
) => (e.deductible === 1 ? Math.floor((e.amountCents * e.businessPct + 50) / 100) : 0);

/**
 * The standard mileage rate already pays for fuel, maintenance and insurance of an automobile
 * (18 section 5.2): such an expense is saved and warned about but not deducted.
 */
export function doubleCounts(db: Db, userId: number, e: ExpenseRow): boolean {
  if (e.vehicleId === null || !expenseCategory(e.category)?.covered_by_standard_rate) return false;
  const kind = createVehicleRepository(db).find(userId, e.vehicleId)?.kind;
  if (!kind || notAutomobile(kind)) return false;
  return (
    deductionMethodFor(db, userId, e.vehicleId, Number(e.spentOn.slice(0, 4))) ===
    'standard_mileage'
  );
}
