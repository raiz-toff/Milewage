import type { Db } from './db';

export type DeductionMethod = 'standard_mileage' | 'actual_expenses';
type Resolver = (userId: number, vehicleId: number, year: number) => DeductionMethod;

const overrides = new WeakMap<Db, Resolver>();

/**
 * How a vehicle is deducted in a tax year (18 section 7.1). Core's answer is the country pack's
 * default, standard mileage. The `tax` module installs its own resolver, so `expenses` and the
 * summary read this and never import `tax` (README section 1.3, rule 1).
 */
export function deductionMethodFor(
  db: Db,
  userId: number,
  vehicleId: number,
  year: number,
): DeductionMethod {
  return overrides.get(db)?.(userId, vehicleId, year) ?? 'standard_mileage';
}

export function overrideDeductionMethod(db: Db, resolver: Resolver | undefined) {
  if (resolver) overrides.set(db, resolver);
  else overrides.delete(db);
}
