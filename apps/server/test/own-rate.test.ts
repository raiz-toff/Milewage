import { afterEach, beforeEach, expect, test } from 'vitest';
import { countryModules, gbCountry } from '@milewage/shared';
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
