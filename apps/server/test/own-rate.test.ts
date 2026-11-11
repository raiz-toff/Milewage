import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { countryModules, gbCountry } from '@milewage/shared';
import { loadMigrations, migrate, MIGRATIONS_DIR, openDatabase } from '../src/db';
import { harness, type Harness } from './support';

// Owner decision Q5: the driver's own rate where the country has no official rates. ZZ is a
// user-assigned ISO code standing for such a country; it has no mileage rates at all.
countryModules.register({
  ...gbCountry,
  code: 'ZZ',
  unit: 'km',
  places: [],
  mileage: { yearStarts: '01-01', methods: ['none'], rates: {} },
});

let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

function seedShift(id: number, vehicleId: number, totalM: number) {
  h.db
    .prepare(
      `INSERT INTO shifts (user_id, client_id, vehicle_id, status, started_at, ended_at, local_date,
         total_m, segmenter, updated_at) VALUES (1, ?, ?, 'ended', ?, ?, '2026-03-01', ?, 'stops', 1)`,
    )
    .run(`00000000-0000-4000-8000-00000000000${id}`, vehicleId, id * 1000, id * 1000 + 1, totalM);
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await web('POST', '/vehicles', { name: 'Car', kind: 'car' });
  await web('POST', '/vehicles', { name: 'Bike', kind: 'bicycle' });
  seedShift(1, 1, 12_500);
  seedShift(2, 2, 5_000);
});
afterEach(() => h.close());

const deductions = async () =>
  (await web('GET', '/shifts'))
    .json()
    .items.map((s: { deduction_cents: number }) => s.deduction_cents);

test('without official rates the own rate values the mileage and says it is yours', async () => {
  const set = await web('PATCH', '/settings', { country: 'ZZ' });
  expect(set.json()).toMatchObject({ own_mileage_rate: null, mileage_rate: 'none' });
  expect(await deductions()).toEqual([null, null]);

  const own = await web('PATCH', '/settings', {
    own_mileage_rate: { cents_per_unit: 30.5, unit: 'km' },
  });
  expect(own.json()).toMatchObject({
    own_mileage_rate: { cents_per_unit: 30.5, unit: 'km' },
    mileage_rate: 'yours',
  });
  // 12.5 km at 30.5 cents is 381.25, so 381; a bicycle gets none, as with an official rate.
  expect(await deductions()).toEqual([null, 381]);
  const csv = (await web('GET', '/exports/csv?from=2026-01-01&to=2026-12-31&level=shift')).body;
  expect(csv.split('\r\n')[0]).toContain(',Deduction_Value_Your_Rate,');

  await web('PATCH', '/settings', { own_mileage_rate: null });
  expect((await web('GET', '/settings')).json().mileage_rate).toBe('none');
});

test('an official rate is never replaced by the own rate', async () => {
  const res = await web('PATCH', '/settings', {
    own_mileage_rate: { cents_per_unit: 99, unit: 'mi' },
  });
  expect(res.json()).toMatchObject({ country: 'US', mileage_rate: 'official' });
  expect(await deductions()).toEqual([null, 563]); // 12.5 km at the IRS 72.5 c/mi
  const csv = (await web('GET', '/exports/csv?from=2026-01-01&to=2026-12-31&level=shift')).body;
  expect(csv.split('\r\n')[0]).toContain(',Deduction_Value,');
});

test('the rate is checked', async () => {
  for (const bad of [
    { cents_per_unit: 0, unit: 'km' },
    { cents_per_unit: 5, unit: 'yd' },
    { unit: 'km' },
  ])
    expect((await web('PATCH', '/settings', { own_mileage_rate: bad })).statusCode).toBe(422);
});

// ADR 0007: your mileage rate has dates and may replace the country's.
describe('dated own rates', () => {
  const rates = () => web('GET', '/own-mileage-rates');
  const add = (b: object) => web('POST', '/own-mileage-rates', b);
  const shifts = async () =>
    (await web('GET', '/shifts')).json().items as {
      id: number;
      deduction_cents: number | null;
      deduction_rate: string | null;
    }[];

  test('added, listed oldest first, edited and removed; one rate per day', async () => {
    const a = await add({
      effective_from: '2026-07-01',
      cents_per_unit: 72.5,
      unit: 'mi',
      note: ' Employer ',
    });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({
      effective_from: '2026-07-01',
      cents_per_unit: 72.5,
      unit: 'mi',
      note: 'Employer',
    });
    await add({ effective_from: null, cents_per_unit: 50, unit: 'mi' });
    expect(
      (await rates()).json().map((r: { effective_from: string | null }) => r.effective_from),
    ).toEqual([null, '2026-07-01']);
    const dup = await add({ effective_from: '2026-07-01', cents_per_unit: 1, unit: 'km' });
    expect([dup.statusCode, dup.json().errors[0].path]).toEqual([422, '/effective_from']);
    expect((await add({ effective_from: null, cents_per_unit: 1, unit: 'km' })).statusCode).toBe(
      422,
    );
    expect(
      (await add({ effective_from: '2026-02-30', cents_per_unit: 1, unit: 'km' })).statusCode,
    ).toBe(422);
    expect(
      (await add({ effective_from: '2026-02-01', cents_per_unit: 0, unit: 'km' })).statusCode,
    ).toBe(422);
    const id = a.json().id;
    const moved = await web('PATCH', `/own-mileage-rates/${id}`, {
      effective_from: '2026-08-01',
      note: null,
    });
    expect(moved.json()).toMatchObject({
      effective_from: '2026-08-01',
      cents_per_unit: 72.5,
      note: null,
    });
    expect((await web('DELETE', `/own-mileage-rates/${id}`)).statusCode).toBe(204);
    expect((await web('DELETE', `/own-mileage-rates/${id}`)).statusCode).toBe(404);
    expect((await rates()).json()).toHaveLength(1);
  });

  test('a rate in two steps: the first rate up to its distance in the year, then the second', async () => {
    const half = await add({
      effective_from: null,
      cents_per_unit: 100,
      unit: 'km',
      threshold_units: 20,
    });
    expect([half.statusCode, half.json().errors[0].path]).toEqual([422, '/cents_per_unit_after']);
    const lone = await add({
      effective_from: null,
      cents_per_unit: 100,
      unit: 'km',
      cents_per_unit_after: 50,
    });
    expect([lone.statusCode, lone.json().errors[0].path]).toEqual([422, '/threshold_units']);
    const a = await add({
      effective_from: null,
      cents_per_unit: 100,
      unit: 'km',
      threshold_units: 20,
      cents_per_unit_after: 50,
    });
    expect(a.json()).toMatchObject({ threshold_units: 20, cents_per_unit_after: 50 });
    await web('PATCH', '/settings', { use_own_mileage_rate: true });
    seedShift(3, 1, 10_000); // the same day as shift 1, after it
    seedShift(4, 1, 5_000);
    h.db.prepare("UPDATE shifts SET local_date = '2026-03-02' WHERE id = 4").run();
    seedShift(5, 1, 5_000);
    h.db.prepare("UPDATE shifts SET local_date = '2027-01-02' WHERE id = 5").run();
    const byId = new Map(
      (await shifts()).map((x) => [x.id, [x.deduction_cents, x.deduction_rate]]),
    );
    expect(byId.get(1)).toEqual([1250, 'yours']); // 12.5 km, all inside the first 20
    expect(byId.get(3)).toEqual([875, 'yours']); // 7.5 km at 100, then 2.5 km at 50
    expect(byId.get(4)).toEqual([250, 'yours']); // past the 20 km: all at 50
    expect(byId.get(5)).toEqual([500, 'yours']); // a new year: the count starts again
    expect(byId.get(2)).toEqual([null, null]); // the bicycle, as ever
    // The phone gets the step and what the server has counted this year (the clock is in 2027).
    const today = (await web('GET', '/settings')).json().own_mileage_rate;
    expect(today).toEqual({
      cents_per_unit: 100,
      unit: 'km',
      step: {
        threshold_units: 20,
        cents_per_unit_after: 50,
        period_start: '2027-01-01',
        driven_m: { car: 5000 },
      },
    });
    // Back to one flat rate: both fields cleared together.
    const flat = await web('PATCH', `/own-mileage-rates/${a.json().id}`, {
      threshold_units: null,
      cents_per_unit_after: null,
    });
    expect(flat.json()).toMatchObject({ threshold_units: null, cents_per_unit_after: null });
    expect((await shifts()).find((x) => x.id === 3)?.deduction_cents).toBe(1000);
  });

  test('switched on, your rate replaces the country rate from its date, never before', async () => {
    seedShift(3, 1, 16_093); // 2026-03-01 like the others
    h.db.prepare("UPDATE shifts SET local_date = '2026-08-01' WHERE id = 3").run();
    await add({ effective_from: '2026-07-01', cents_per_unit: 60, unit: 'mi' });
    // Off: the US rate everywhere, as before.
    let s = await shifts();
    expect(s.map((x) => [x.deduction_cents, x.deduction_rate])).toEqual([
      [760, 'official'], // 16,093 m (10 miles) at the IRS 76 c/mi from 1 July 2026
      [null, null], // the bicycle has no rate
      [563, 'official'],
    ]);
    const on = await web('PATCH', '/settings', { use_own_mileage_rate: true });
    expect(on.json()).toMatchObject({ use_own_mileage_rate: true });
    s = await shifts();
    expect(s.map((x) => [x.deduction_cents, x.deduction_rate])).toEqual([
      [600, 'yours'], // 10 miles at 60 cents
      [null, null],
      [563, 'official'], // March is before your rate: still the country's
    ]);
    const summary = (await web('GET', '/summary?from=2026-01-01&to=2026-12-31')).json();
    expect(summary).toMatchObject({ deduction_cents: 1163, deduction_rate: 'mixed' });
    const csv = (await web('GET', '/exports/csv?from=2026-01-01&to=2026-12-31&level=shift')).body
      .split('\r\n')
      .filter(Boolean);
    expect(csv[0]).toContain(',Deduction_Value,');
    expect(csv[0]!.endsWith(',Deduction_Rate')).toBe(true);
    expect(csv.slice(1).map((r) => r.split(',').at(-1))).toEqual(['country rate', '', 'your rate']);
    // Today (the clock is in 2027) is past 2026's last published US rate, so your rate is in force.
    expect((await web('GET', '/settings')).json()).toMatchObject({
      mileage_rate: 'yours',
      own_mileage_rate: { cents_per_unit: 60, unit: 'mi' },
    });
  });

  test('the tax report names the rate and says yours is not official', async () => {
    await web('PATCH', '/settings', { country: 'CA', region: 'ON', use_own_mileage_rate: true });
    await add({ effective_from: '2026-01-01', cents_per_unit: 50, unit: 'km' });
    const tax = (await web('GET', '/tax/2026')).json();
    expect(tax.deductions).toMatchObject({ mileage_cents: 625, mileage_rate: 'yours' });
    expect(tax.notices).toContain(
      'The mileage deduction uses your mileage rate, not an official rate.',
    );
    const rows = (await web('GET', '/exports/tax_summary?year=2026')).body.split('\r\n');
    expect(rows).toContain('Mileage_Rate,Source,your rate (not an official rate)');
  });

  test('the old single rate is the undated one: PATCH /settings sets and clears it', async () => {
    await web('PATCH', '/settings', { country: 'ZZ' });
    await add({ effective_from: '2026-06-01', cents_per_unit: 40, unit: 'km' });
    await web('PATCH', '/settings', { own_mileage_rate: { cents_per_unit: 30.5, unit: 'km' } });
    expect((await rates()).json()).toMatchObject([
      { effective_from: null, cents_per_unit: 30.5 },
      { effective_from: '2026-06-01', cents_per_unit: 40 },
    ]);
    // Without country rates your rate values the mileage whatever the switch says (Q5).
    const car = async () => (await shifts()).find((x) => x.id === 1);
    expect(await car()).toMatchObject({ deduction_cents: 381, deduction_rate: 'yours' });
    await web('PATCH', '/settings', { own_mileage_rate: null });
    expect((await rates()).json()).toHaveLength(1);
    expect(await car()).toMatchObject({ deduction_cents: null, deduction_rate: null });
  });
});

test('migration core 0014 keeps the undated rate and switches nothing on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-own-'));
  const db = openDatabase(join(dir, 'm.db'));
  try {
    const all = loadMigrations(MIGRATIONS_DIR);
    const at = all.findIndex((m) => m.module === 'core' && m.id === '0014_own_mileage_rates');
    migrate(db, all.slice(0, at));
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'o', 'x', 1)",
    ).run();
    db.prepare(
      `INSERT INTO settings (user_id, country, distance_unit, currency, timezone, own_rate_hundredths, own_rate_unit, updated_at)
       VALUES (1, 'US', 'mi', 'USD', 'UTC', 3050, 'km', 7)`,
    ).run();
    migrate(db, all);
    expect(
      db
        .prepare('SELECT user_id, effective_from, hundredths, unit, note FROM own_mileage_rates')
        .all(),
    ).toEqual([{ user_id: 1, effective_from: null, hundredths: 3050, unit: 'km', note: null }]);
    const cols = (db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('use_own_rate');
    expect(cols).not.toContain('own_rate_hundredths');
    expect(db.prepare('SELECT use_own_rate FROM settings').pluck().get()).toBe(0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
