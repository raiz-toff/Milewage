import { afterEach, expect, test } from 'vitest';
import { countryTree } from '../src/routes/countries';
import { harness, type Harness } from './support';

let h: Harness | undefined;
afterEach(() => h?.close());

test('GET /countries answers without a login, before and during setup, with names and regions', async () => {
  h = harness();
  const before = await h.call('GET', '/countries');
  expect(before.statusCode).toBe(200);
  const list = before.json() as { code: string; name: string; regions: object[] }[];
  expect(list.map((c) => [c.code, c.name])).toEqual([
    ['US', 'United States'],
    ['CA', 'Canada'],
    ['GB', 'United Kingdom'],
  ]);
  await h.signUpUnconfirmed();
  expect((await h.call('GET', '/countries')).json()).toEqual(list);

  const ca = list.find((c) => c.code === 'CA')!;
  expect(ca).toMatchObject({
    currency: 'CAD',
    unit: 'km',
    labels: { region: 'province', city: null },
    supports: { mileage: true, tax: true },
    verified: false,
    regional_rules: true,
  });
  expect(ca.regions).toHaveLength(13);
  expect(ca.regions).toContainEqual({
    code: 'ON',
    name: 'Ontario',
    own_rules: true,
    verified: false,
    cities: [],
  });
  expect(ca.regions).toContainEqual(expect.objectContaining({ code: 'AB', own_rules: false }));
  expect(list.find((c) => c.code === 'US')).toMatchObject({
    labels: { region: 'state' },
    supports: { mileage: true, tax: false },
    regional_rules: false,
  });
});

test('the tree follows the operator: allowed countries only; tax_countries can only hide tax', async () => {
  h = harness({}, { comma: { taxCountries: [] } });
  const ca = (await h.call('GET', '/countries'))
    .json()
    .find((c: { code: string }) => c.code === 'CA');
  expect(ca.supports).toEqual({ mileage: true, tax: false });

  expect(countryTree(['GB', 'XX'], ['GB']).map((c) => [c.code, c.supports.tax])).toEqual([
    ['GB', false],
  ]);
});
