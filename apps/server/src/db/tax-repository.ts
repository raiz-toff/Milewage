import type { DeductionMethod } from '../mileage-deduction';
import type { Db } from './open';

export interface TaxYearRow {
  setAsideBp: number;
  salesTaxRegistered: number;
  /** 1 when the driver pays by instalments in this tax year. */
  paysInstalments: number;
}
export interface JarRow {
  id: number;
  taxYear: number;
  amountCents: number;
  enteredOn: string;
  note: string | null;
}
export interface VehicleTaxYearRow {
  vehicleId: number;
  taxYear: number;
  method: DeductionMethod;
  rate1Milli: number | null;
  rate2Milli: number | null;
  thresholdM: number | null;
}

export const DEFAULT_SET_ASIDE_BP = 2500;

/** Tax inputs, the jar and per-vehicle methods (module `tax`). */
export function createTaxRepository(db: Db) {
  return {
    year: (userId: number, year: number): TaxYearRow =>
      (db
        .prepare(
          'SELECT set_aside_bp AS setAsideBp, sales_tax_registered AS salesTaxRegistered, pays_instalments AS paysInstalments FROM tax_years WHERE user_id = ? AND tax_year = ?',
        )
        .get(userId, year) as TaxYearRow | undefined) ?? {
        setAsideBp: DEFAULT_SET_ASIDE_BP,
        salesTaxRegistered: 0,
        paysInstalments: 0,
      },
    putYear(userId: number, year: number, r: TaxYearRow) {
      db.prepare(
        `INSERT INTO tax_years (user_id, tax_year, set_aside_bp, sales_tax_registered, pays_instalments) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, tax_year) DO UPDATE SET set_aside_bp = excluded.set_aside_bp,
           sales_tax_registered = excluded.sales_tax_registered,
           pays_instalments = excluded.pays_instalments`,
      ).run(userId, year, r.setAsideBp, r.salesTaxRegistered, r.paysInstalments);
    },
    jar: (userId: number, year: number): JarRow[] =>
      db
        .prepare(
          'SELECT id, tax_year AS taxYear, amount_cents AS amountCents, entered_on AS enteredOn, note FROM tax_jar_entries WHERE user_id = ? AND tax_year = ? ORDER BY entered_on DESC, id DESC',
        )
        .all(userId, year) as JarRow[],
    addJar(userId: number, year: number, amount: number, on: string, note: string | null): JarRow {
      const id = db
        .prepare(
          'INSERT INTO tax_jar_entries (user_id, tax_year, amount_cents, entered_on, note) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, year, amount, on, note).lastInsertRowid;
      return { id: Number(id), taxYear: year, amountCents: amount, enteredOn: on, note };
    },
    deleteJar: (userId: number, id: number): boolean =>
      db.prepare('DELETE FROM tax_jar_entries WHERE user_id = ? AND id = ?').run(userId, id)
        .changes > 0,
    vehicleYear: (userId: number, vehicleId: number, year: number): VehicleTaxYearRow | undefined =>
      db
        .prepare(
          `SELECT vehicle_id AS vehicleId, tax_year AS taxYear, method, rate1_milli AS rate1Milli,
                  rate2_milli AS rate2Milli, threshold_m AS thresholdM
             FROM vehicle_tax_years WHERE user_id = ? AND vehicle_id = ? AND tax_year = ?`,
        )
        .get(userId, vehicleId, year) as VehicleTaxYearRow | undefined,
    vehicleYears: (userId: number, year: number): VehicleTaxYearRow[] =>
      db
        .prepare(
          `SELECT vehicle_id AS vehicleId, tax_year AS taxYear, method, rate1_milli AS rate1Milli,
                  rate2_milli AS rate2Milli, threshold_m AS thresholdM
             FROM vehicle_tax_years WHERE user_id = ? AND tax_year = ?`,
        )
        .all(userId, year) as VehicleTaxYearRow[],
    putVehicleYear(userId: number, r: VehicleTaxYearRow) {
      db.prepare(
        `INSERT INTO vehicle_tax_years (user_id, vehicle_id, tax_year, method, rate1_milli, rate2_milli, threshold_m)
         VALUES (@userId, @vehicleId, @taxYear, @method, @rate1Milli, @rate2Milli, @thresholdM)
         ON CONFLICT (vehicle_id, tax_year) DO UPDATE SET method = @method, rate1_milli = @rate1Milli,
           rate2_milli = @rate2Milli, threshold_m = @thresholdM`,
      ).run({ ...r, userId });
    },
    deleteVehicleYear: (userId: number, vehicleId: number, year: number) =>
      void db
        .prepare(
          'DELETE FROM vehicle_tax_years WHERE user_id = ? AND vehicle_id = ? AND tax_year = ?',
        )
        .run(userId, vehicleId, year),
  };
}
