import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { countryModules, mileageDeduction, UNIT_METRES } from '@milewage/shared';
import { createExpenseRepository, createShiftRepository, type Db, type ShiftRow } from '../src/db';
import { createDriverContexts } from '../src/driver-context';
import { createMileageDeduction, type DeductionMethods } from '../src/mileage-deduction';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const MI = UNIT_METRES.mi;

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await web('POST', '/vehicles', { name: 'Car', kind: 'car' });
  await web('POST', '/vehicles', { name: 'Bike', kind: 'bicycle' });
});
afterEach(() => h.close());

const deductionOn = (db: Db, methods?: DeductionMethods) =>
  createMileageDeduction({
    db,
    drivers: createDriverContexts({ db, now: () => h.clock.t, stopsModule: () => true }),
    methods,
  });

let seq = 0;
/** A stored shift with its totals; the deduction reads nothing else. */
function seed(o: {
  date: string;
  hour?: number;
  totalM: number;
  personalM?: number;
  vehicle?: number;
  status?: ShiftRow['status'];
}): ShiftRow {
  seq += 1;
  const startedAt = Date.parse(`${o.date}T${String(o.hour ?? 9).padStart(2, '0')}:00:00Z`);
  return createShiftRepository(h.db).insert({
    userId: 1,
    clientId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    vehicleId: o.vehicle ?? 1,
    status: o.status ?? 'ended',
    startedAt,
    endedAt: startedAt + 3_600_000,
    localDate: o.date,
    totalM: o.totalM,
    activeM: o.totalM - (o.personalM ?? 0),
    deadheadM: 0,
    personalM: o.personalM ?? 0,
    segmenter: 'whole_shift',
    updatedAt: startedAt,
  });
}

describe('the deduction distance is the business distance', () => {
  test('a shift with a personal trip deducts less than the same shift without', async () => {
    const t = Date.parse('2026-09-15T18:00:00Z'); // a day with a published US rate
    const trip = async (shift: number, n: number, kind: string, metres: number) =>
      web('PUT', `/shifts/${shift}/trips/00000000-0000-4000-8000-0000000000${shift}${n}`, {
        kind,
        started_at: t - 3 * 3_600_000 + n * 60_000,
        ended_at: t - 3 * 3_600_000 + (n + 1) * 60_000,
        distance_m: metres,
        purpose: kind === 'personal' ? 'Groceries' : 'Orders',
        edited_at: h.clock.t,
      });
    for (const n of [1, 2]) {
      await web('POST', '/shifts', {
        client_id: `00000000-0000-4000-8000-00000000000${n}`,
        vehicle_id: 1,
        started_at: t - 4 * 3_600_000 + n * 60_000,
      });
      await web('POST', `/shifts/${n}/end`, { ended_at: t - 3 * 3_600_000 });
    }
    // Shift 1: 16 km for work and 6 personal. Shift 2: the same 22 km, all for work.
    await trip(1, 1, 'active', 16_000);
    await trip(1, 2, 'personal', 6_000);
    await trip(2, 1, 'active', 22_000);
    const [one, two] = [
      (await web('GET', '/shifts/1')).json(),
      (await web('GET', '/shifts/2')).json(),
    ];
    // Total miles never depend on the kind of a trip (decision 1.5b); the deduction does.
    expect(one.total_m).toBe(two.total_m);
    expect(one.personal_m).toBe(6_000);
    expect(one.deduction_cents).toBeLessThan(two.deduction_cents);
    const us = countryModules.get('US')!;
    const at = (m: number) =>
      mileageDeduction(us, { totalM: m, priorM: 0, date: one.local_date, vehicleKind: 'car' });
    expect(one.deduction_cents).toBe(at(16_000));
    expect(two.deduction_cents).toBe(at(22_000));
    const day = one.local_date;
    const summary = (await web('GET', `/summary?from=${day}&to=${day}`)).json();
    expect(summary.deduction_cents).toBe(one.deduction_cents + two.deduction_cents);
  });

  test('a split between active and deadhead does not change it (decision 1.5b)', () => {
    const a = seed({ date: '2026-12-01', totalM: 16_093 });
    const b = createShiftRepository(h.db).update(seed({ date: '2026-12-02', totalM: 16_093 }).id, {
      activeM: 6_093,
      deadheadM: 10_000,
    })!;
    const [x, y] = deductionOn(h.db).ofShifts([a, b]);
    expect(x).toBe(y);
  });
});

describe('tiered rates (Great Britain: 10,000 miles a tax year from 6 April)', () => {
  beforeEach(async () => {
    await web('PATCH', '/settings', { country: 'GB', currency: 'GBP' });
  });

  test('the tier fills in shift order, with business miles only, and restarts on 6 April', () => {
    // The tax year before: 9,000 miles that do not count towards 2026-27.
    const s0 = seed({ date: '2026-04-05', totalM: Math.round(9000 * MI) });
    // 7,000 miles of which 1,000 personal: 6,000 fill the first tier.
    const s1 = seed({
      date: '2026-12-01',
      hour: 8,
      totalM: Math.round(7000 * MI),
      personalM: Math.round(1000 * MI),
    });
    // The same day, later: 4,000 miles at the first rate, 2,000 at the second.
    const s2 = seed({ date: '2026-12-01', hour: 14, totalM: Math.round(6000 * MI) });
    const bike = seed({ date: '2026-12-01', hour: 16, totalM: 5000, vehicle: 2 });
    const d = deductionOn(h.db);
    const want = [4000 * 55 + 2000 * 25, 9000 * 45, 6000 * 55, null];
    // Any order and any subset gives each shift the same value: what came before is read from the book.
    expect(d.ofShifts([s2, s0, s1, bike])).toEqual(want);
    expect([s2, s0, s1, bike].map((s) => d.ofShifts([s])[0])).toEqual(want);
    expect(d.ofPeriod(1, '2026-04-06', '2027-04-05')).toEqual({
      cents: 6000 * 55 + 4000 * 55 + 2000 * 25,
      byVehicle: new Map([[1, 6000 * 55 + 4000 * 55 + 2000 * 25]]),
    });
  });

  test('a running shift has no value, nor does a period without any', () => {
    const running = seed({ date: '2026-12-01', totalM: 10_000, status: 'active' });
    const d = deductionOn(h.db);
    expect(d.ofShifts([running])).toEqual([null]);
    expect(d.ofPeriod(1, '2026-12-01', '2026-12-31')).toEqual({
      cents: null,
      byVehicle: new Map(),
    });
  });
});

describe('the deduction method is injected', () => {
  test('without a source every vehicle is deducted by the mileage rate', () => {
    const s = seed({ date: '2026-12-01', totalM: 16_093 });
    const d = deductionOn(h.db);
    expect(d.method(1, 1, 2026)).toBe('standard_mileage');
    expect(d.ofShifts([s])[0]).toBeGreaterThan(0);
  });

  test('an actual-expenses vehicle has no mileage value that year, and its fuel is not double-counted', async () => {
    const s25 = seed({ date: '2025-12-01', totalM: 16_093 });
    const s26 = seed({ date: '2026-01-02', totalM: 16_093 });
    const asked: number[] = [];
    const d = deductionOn(h.db, (userId, year) => {
      asked.push(year);
      return new Map(year === 2025 ? [[1, 'actual_expenses' as const]] : []);
    });
    expect(d.ofShifts([s25, s26]).map((v) => v === null)).toEqual([true, false]);
    expect(asked).toEqual([2025, 2026]); // once per year, not once per shift
    expect(d.method(1, 1, 2025)).toBe('actual_expenses');
    await web('POST', '/expenses', {
      spent_on: '2025-12-03',
      category: 'fuel',
      amount_cents: 5000,
      merchant: 'Shell',
      vehicle_id: 1,
    });
    const e = createExpenseRepository(h.db).between(1, '2025-12-01', '2025-12-31')[0]!;
    expect(d.doubleCounts(1, e)).toBe(false);
    expect(deductionOn(h.db).doubleCounts(1, e)).toBe(true);
  });

  test('the tax module is the source while it is on', async () => {
    seed({ date: '2026-12-01', totalM: 16_093 });
    expect((await web('GET', '/shifts/1')).json().deduction_cents).toBeGreaterThan(0);
    await web('PUT', '/vehicles/1/tax-years/2026', { method: 'actual_expenses' });
    expect((await web('GET', '/shifts/1')).json().deduction_cents).toBeNull();
  });
});

test('a list of shifts costs a few queries, not four per shift', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    seed({
      date: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`,
      hour: 8 + (i % 10),
      totalM: 5000,
    }),
  );
  let runs = 0;
  const count = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, prop) {
        const v = Reflect.get(t, prop) as unknown;
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          if (['all', 'get', 'run', 'iterate'].includes(String(prop))) runs += 1;
          const out = (v as (...a: unknown[]) => unknown).apply(t, args);
          if (out === t) return count(t);
          return prop === 'prepare' ? count(out as object) : out;
        };
      },
    });
  const d = deductionOn(count(h.db), () => new Map());
  runs = 0;
  const values = d.ofShifts(rows);
  expect(values.every((v) => v !== null && v > 0)).toBe(true);
  // Settings, vehicles, one tax year, one rate period: four, whatever the number of shifts.
  expect(runs).toBeLessThanOrEqual(4);
});
