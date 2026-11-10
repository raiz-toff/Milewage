import {
  expenseCategory,
  mileageDeduction,
  notAutomobile,
  ownRateAt,
  ownRateDeduction,
  periodStart,
  rateSourceAt,
  valueAt,
  type CountryModule,
  type Dated,
  type RateSource,
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

/** A shift's mileage deduction and the rate that valued it (null when there is no value). */
export interface ValuedShift {
  cents: number | null;
  rate: RateSource | null;
}

/** Which rate valued the deductions of a period: one kind, both (by date), or none. */
export type PeriodRate = RateSource | 'mixed' | null;

/** One rate that valued at least one shift, for a report that names the rates it used. */
export type RateUsed =
  | {
      source: 'official';
      vehicleKind: VehicleKind;
      /** The pack's own words: "Standard mileage rate, business", "First 5,000 km". */
      label: string;
      centsPerUnit: number;
      unit: 'km' | 'mi';
      /** The date this value of the published rate starts. */
      from: string;
    }
  | {
      source: 'yours';
      centsPerUnit: number;
      unit: 'km' | 'mi';
      /** Null: from the start. */
      from: string | null;
    };

export interface MileageDeduction {
  /**
   * The mileage deduction of each shift, in cents, in the order given: business distance (total
   * miles less personal miles) times the rate of the owner's country pack for the shift's date, with
   * the business metres of the same vehicle kind already driven in the rate period (calendar year,
   * or the tax year from 6 April in Great Britain) so tiered rates split correctly. Your mileage
   * rate instead from its date when you chose it, or where the country has no rates (owner decision
   * Q5, ADR 0007). Null for a running shift, for no rate, and for a vehicle deducted through its
   * actual expenses that year. A few queries for any number of shifts.
   */
  ofShifts(rows: readonly ShiftRow[]): (number | null)[];
  /** The same, each with the rate that valued it. */
  valued(rows: readonly ShiftRow[]): ValuedShift[];
  /**
   * The ended and finalized shifts with a local date in `[from, to]`: the sum of their deductions
   * (null when none has one), the sum per vehicle (only vehicles with a value) and which rate valued them.
   */
  ofPeriod(
    userId: number,
    from: string,
    to: string,
  ): { cents: number | null; byVehicle: ReadonlyMap<number, number>; rate: PeriodRate };
  /** Each distinct rate that valued one of these shifts, in date order. */
  ratesUsed(rows: readonly ShiftRow[]): RateUsed[];
  /** How a vehicle is deducted in a year. */
  method(userId: number, vehicleId: number, year: number): DeductionMethod;
  /**
   * A double-counted expense: fuel, maintenance or insurance of an automobile that is deducted by
   * the mileage rate that year, which already pays for it (18 section 5.2). Saved, but not deducted.
   */
  doubleCounts(userId: number, e: ExpenseRow): boolean;
}

/** One rate, both, or none: the words a period's deduction carries. */
export function periodRate(values: readonly Pick<ValuedShift, 'rate'>[]): PeriodRate {
  const rates = new Set(values.map((v) => v.rate).filter((r) => r !== null));
  return rates.size === 0 ? null : rates.size > 1 ? 'mixed' : [...rates][0]!;
}

/** The start of the value of a dated rate in force on a date. */
const startOf = (p: Dated<number>, date: string) =>
  Object.keys(p.values)
    .sort()
    .filter((d) => d <= date)
    .at(-1) ?? date;

/** The published values a country's rate for a vehicle kind has on a date (both tiers of a tiered rate). */
function officialValues(c: CountryModule, kind: VehicleKind, date: string) {
  const rate = c.mileage.rates[kind];
  const params = !rate ? [] : rate.kind === 'flat' ? [rate.perUnit] : [rate.first, rate.after];
  return params.flatMap((p) => {
    const v = valueAt(p, date);
    return v === null ? [] : [{ label: p.label, centsPerUnit: v, from: startOf(p, date) }];
  });
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

  /** Shifts that get a value, with the rate source of their date; the rest stay null. */
  function sourcesOf(userId: number, rows: readonly ShiftRow[]) {
    const driver = drivers.find(userId);
    const out: (RateSource | null)[] = rows.map(() => null);
    if (!driver) return { driver, out };
    const method = methodOf(userId);
    rows.forEach((r, n) => {
      if (r.totalM === null || r.status === 'active') return;
      // A vehicle deducted through its expenses has no mileage deduction value (18 section 7.1).
      if (method(r.vehicleId, Number(r.localDate.slice(0, 4))) === 'actual_expenses') return;
      const source = rateSourceAt(driver.pack, driver.ownRates, r.localDate);
      out[n] = source === 'none' ? null : source;
    });
    return { driver, out };
  }

  function ofUser(userId: number, rows: readonly ShiftRow[], out: ValuedShift[], at: number[]) {
    const { driver, out: sources } = sourcesOf(userId, rows);
    if (!driver) return;
    const kinds = new Map(vehicles.list(userId, true).map((v) => [v.id, v.kind as VehicleKind]));
    // Shifts valued at official rates, by rate period and vehicle kind: one query per group.
    const groups = new Map<string, { kind: VehicleKind; from: string; items: number[] }>();
    const value = (n: number, cents: number | null, rate: RateSource) =>
      (out[at[n]!] = { cents, rate: cents === null ? null : rate });
    rows.forEach((r, n) => {
      const source = sources[n];
      if (!source) return;
      const kind = kinds.get(r.vehicleId) ?? 'car';
      if (source === 'yours') {
        // One rate per shift: the one in force on its date, flat, with no tier (ADR 0007).
        const own = ownRateAt(driver.ownRates.rates, r.localDate)!;
        value(n, ownRateDeduction(own, { totalM: businessM(r), vehicleKind: kind }), 'yours');
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
      // Every business metre of the period fills the tier, whichever rate valued it.
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
        const cents = mileageDeduction(driver.pack!, {
          totalM: businessM(r),
          priorM: prior.get(r)!,
          date: r.localDate,
          vehicleKind: g.kind,
        });
        value(n, cents, 'official');
      }
    }
  }

  const valued = (rows: readonly ShiftRow[]) => {
    const out: ValuedShift[] = rows.map(() => ({ cents: null, rate: null }));
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
    ofShifts: (rows) => valued(rows).map((v) => v.cents),
    valued,
    ofPeriod(userId, from, to) {
      const rows = processing.shiftsInPeriod(userId, from, to);
      const values = valued(rows);
      const byVehicle = new Map<number, number>();
      let cents: number | null = null;
      values.forEach((v, i) => {
        if (v.cents === null) return;
        cents = (cents ?? 0) + v.cents;
        const id = rows[i]!.vehicleId;
        byVehicle.set(id, (byVehicle.get(id) ?? 0) + v.cents);
      });
      return { cents, byVehicle, rate: periodRate(values) };
    },
    ratesUsed(rows) {
      const used = new Map<string, RateUsed>();
      const values = valued(rows);
      const contexts = new Map<number, ReturnType<DriverContexts['find']>>();
      const driverOf = (userId: number) => {
        if (!contexts.has(userId)) contexts.set(userId, drivers.find(userId));
        return contexts.get(userId);
      };
      rows.forEach((r, n) => {
        const v = values[n]!;
        const driver = v.rate && driverOf(r.userId);
        if (!driver || !v.rate) return;
        if (v.rate === 'yours') {
          const own = ownRateAt(driver.ownRates.rates, r.localDate)!;
          const { centsPerUnit, unit, effectiveFrom: from } = own;
          used.set(`yours|${from}`, { source: 'yours', centsPerUnit, unit, from });
          return;
        }
        const kind = (vehicles.find(r.userId, r.vehicleId)?.kind ?? 'car') as VehicleKind;
        for (const o of officialValues(driver.pack!, kind, r.localDate)) {
          used.set(`official|${kind}|${o.label}|${o.from}`, {
            source: 'official',
            vehicleKind: kind,
            unit: driver.pack!.unit,
            ...o,
          });
        }
      });
      return [...used.values()].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
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
