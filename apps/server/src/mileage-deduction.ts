import {
  expenseCategory,
  mileageDeduction,
  notAutomobile,
  ownRateDeduction,
  periodStart,
  type VehicleKind,
} from '@milewage/shared';
import {
  createProcessingRepository,
  createVehicleRepository,
  type Db,
  type ExpenseRow,
  type ShiftRow,
} from './db';
import type { DriverContexts } from './driver-context';

/** How a vehicle is deducted in a tax year (18 section 7.1): by the mileage rate or by its actual expenses, never both. */
export type DeductionMethod = 'standard_mileage' | 'actual_expenses';

/**
 * The deduction method saved for each vehicle in a year. A vehicle that is not in the map, and every
 * vehicle when no source is given, is deducted by the mileage rate (the country pack's default).
 * The `tax` module supplies the one source there is; `expenses` and the summary never import `tax`
 * (README section 1.3, rule 1).
 */
export type DeductionMethods = (
  userId: number,
  year: number,
) => ReadonlyMap<number, DeductionMethod>;

export interface MileageDeduction {
  /**
   * The mileage deduction of each shift, in cents, in the order given: business distance (total
   * miles less personal miles) times the rate of the owner's country pack for the shift's date, with
   * the business metres of the same vehicle kind already driven in the rate period (calendar year,
   * or the tax year from 6 April in Great Britain) so tiered rates split correctly. Where the country
   * has no rates, your mileage rate (owner decision Q5). Null for a running shift, for no rate, and
   * for a vehicle deducted through its actual expenses that year. A few queries for any number of shifts.
   */
  ofShifts(rows: readonly ShiftRow[]): (number | null)[];
  /**
   * The ended and finalized shifts with a local date in `[from, to]`: the sum of their deductions
   * (null when none has one) and the sum per vehicle (only vehicles with a value).
   */
  ofPeriod(
    userId: number,
    from: string,
    to: string,
  ): { cents: number | null; byVehicle: ReadonlyMap<number, number> };
  /** How a vehicle is deducted in a year. */
  method(userId: number, vehicleId: number, year: number): DeductionMethod;
  /**
   * A double-counted expense: fuel, maintenance or insurance of an automobile that is deducted by
   * the mileage rate that year, which already pays for it (18 section 5.2). Saved, but not deducted.
   */
  doubleCounts(userId: number, e: ExpenseRow): boolean;
}

/** Business distance: what was driven for work, active plus deadhead, whatever the split. */
const businessM = (r: Pick<ShiftRow, 'totalM' | 'personalM'>) =>
  Math.max(0, (r.totalM ?? 0) - (r.personalM ?? 0));

/** Position of a shift in its rate period; earlier shifts fill the lower tier first. */
type Key = { localDate: string; startedAt: number; id: number };
const before = (a: Key, b: Key) =>
  a.localDate < b.localDate ||
  (a.localDate === b.localDate &&
    (a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id)));

export function createMileageDeduction({
  db,
  drivers,
  methods,
}: {
  db: Db;
  drivers: DriverContexts;
  /** The `tax` module's saved methods; absent while the module is off. */
  methods?: DeductionMethods;
}): MileageDeduction {
  const vehicles = createVehicleRepository(db);
  const processing = createProcessingRepository(db);
  const driven = db.prepare(
    `SELECT s.id, s.local_date AS localDate, s.started_at AS startedAt, s.total_m AS totalM, s.personal_m AS personalM
       FROM shifts s JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.user_id = ? AND s.status IN ('ended','finalized') AND v.kind = ?
        AND s.local_date >= ? AND s.local_date <= ?
      ORDER BY s.local_date, s.started_at, s.id`,
  );
  const methodOf = (userId: number) => {
    const years = new Map<number, ReadonlyMap<number, DeductionMethod>>();
    return (vehicleId: number, year: number): DeductionMethod => {
      if (!methods) return 'standard_mileage';
      if (!years.has(year)) years.set(year, methods(userId, year));
      return years.get(year)!.get(vehicleId) ?? 'standard_mileage';
    };
  };

  function ofUser(userId: number, rows: readonly ShiftRow[], out: (number | null)[], at: number[]) {
    const driver = drivers.find(userId);
    if (!driver || driver.rateSource === 'none') return;
    const kinds = new Map(vehicles.list(userId, true).map((v) => [v.id, v.kind as VehicleKind]));
    const method = methodOf(userId);
    // Shifts valued at official rates, by rate period and vehicle kind: one query per group.
    const groups = new Map<string, { kind: VehicleKind; from: string; items: number[] }>();
    rows.forEach((r, n) => {
      if (r.totalM === null || r.status === 'active') return;
      // A vehicle deducted through its expenses has no mileage deduction value (18 section 7.1).
      if (method(r.vehicleId, Number(r.localDate.slice(0, 4))) === 'actual_expenses') return;
      const kind = kinds.get(r.vehicleId) ?? 'car';
      if (driver.rateSource === 'yours') {
        out[at[n]!] = ownRateDeduction(driver.ownRate!, {
          totalM: businessM(r),
          vehicleKind: kind,
        });
        return;
      }
      const from = periodStart(driver.pack!.mileage, r.localDate);
      const key = `${from}|${kind}`;
      const g = groups.get(key) ?? { kind, from, items: [] };
      g.items.push(n);
      groups.set(key, g);
    });
    for (const g of groups.values()) {
      const targets = g.items.map((n) => rows[n]!).sort((a, b) => (before(a, b) ? -1 : 1));
      const last = targets.at(-1)!.localDate;
      const earlier = driven.all(userId, g.kind, g.from, last) as (Key & {
        totalM: number | null;
        personalM: number | null;
      })[];
      // Walk both lists in period order, summing what came before each target.
      const prior = new Map<ShiftRow, number>();
      let sum = 0;
      let i = 0;
      for (const t of targets) {
        while (i < earlier.length && before(earlier[i]!, t)) sum += businessM(earlier[i++]!);
        prior.set(t, sum);
      }
      for (const n of g.items) {
        const r = rows[n]!;
        out[at[n]!] = mileageDeduction(driver.pack!, {
          totalM: businessM(r),
          priorM: prior.get(r)!,
          date: r.localDate,
          vehicleKind: g.kind,
        });
      }
    }
  }

  const ofShifts = (rows: readonly ShiftRow[]) => {
    const out: (number | null)[] = rows.map(() => null);
    const users = new Map<number, number[]>();
    rows.forEach((r, i) => users.set(r.userId, [...(users.get(r.userId) ?? []), i]));
    for (const [userId, at] of users) {
      ofUser(
        userId,
        at.map((i) => rows[i]!),
        out,
        at,
      );
    }
    return out;
  };

  return {
    ofShifts,
    ofPeriod(userId, from, to) {
      const rows = processing.shiftsInPeriod(userId, from, to);
      const values = ofShifts(rows);
      const byVehicle = new Map<number, number>();
      let cents: number | null = null;
      values.forEach((v, i) => {
        if (v === null) return;
        cents = (cents ?? 0) + v;
        const id = rows[i]!.vehicleId;
        byVehicle.set(id, (byVehicle.get(id) ?? 0) + v);
      });
      return { cents, byVehicle };
    },
    method: (userId, vehicleId, year) => methodOf(userId)(vehicleId, year),
    doubleCounts(userId, e) {
      if (e.vehicleId === null || !expenseCategory(e.category)?.covered_by_standard_rate)
        return false;
      const kind = vehicles.find(userId, e.vehicleId)?.kind;
      if (!kind || notAutomobile(kind)) return false;
      return methodOf(userId)(e.vehicleId, Number(e.spentOn.slice(0, 4))) === 'standard_mileage';
    },
  };
}
