import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { expenseCategory } from '@milewage/shared';
import { harness, type Harness } from './support';

// 21 section 3.6c: rent and finance payments for a vehicle that is not owned outright.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const add = async (category: string, over: object = {}) =>
  (
    await send('POST', '/expenses', {
      spent_on: '2027-01-10',
      category,
      amount_cents: 15_000,
      merchant: 'Moove',
      ...over,
    })
  ).json();

describe('vehicle rental and finance categories', () => {
  test('the category list has both, vehicle related; lease and loan interest are unchanged', async () => {
    const list = (await send('GET', '/expenses/categories')).json() as { slug: string }[];
    const slugs = list.map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['leasing', 'interest']));
    expect(list.filter((c) => c.slug.startsWith('vehicle_'))).toEqual([
      expect.objectContaining({
        slug: 'vehicle_rental',
        label: 'Vehicle rental',
        vehicle_related: true,
        default_deductible: true,
      }),
      expect.objectContaining({
        slug: 'vehicle_finance',
        label: 'Finance or hire-purchase payments',
        vehicle_related: true,
        default_deductible: false,
      }),
    ]);
    expect(expenseCategory('leasing')).toMatchObject({
      default_deductible: true,
      covered_by_standard_rate: false,
    });
  });

  test('a finance payment is saved but not deductible unless the driver ticks it', async () => {
    const plain = await add('vehicle_finance');
    expect([plain.deductible, plain.business_pct, plain.deductible_cents]).toEqual([false, 100, 0]);
    const ticked = await add('vehicle_finance', { deductible: true });
    expect(ticked.deductible_cents).toBe(15_000);
    const rent = await add('vehicle_rental');
    expect([rent.deductible, rent.deductible_cents]).toEqual([true, 15_000]);
  });

  test('on a car under the standard mileage rate both are flagged as counting twice', async () => {
    await send('POST', '/vehicles', { name: 'Corolla', kind: 'car', ownership: 'rented' });
    await send('POST', '/vehicles', { name: 'Yulu', kind: 'scooter', ownership: 'rented' });
    expect((await add('vehicle_rental', { vehicle_id: 1 })).double_counts).toBe(true);
    expect((await add('vehicle_finance', { vehicle_id: 1 })).double_counts).toBe(true);
    expect((await add('vehicle_rental', { vehicle_id: 2 })).double_counts).toBe(false); // no rate
    await send('PUT', '/vehicles/1/tax-years/2027', { method: 'actual_expenses' });
    expect((await add('vehicle_rental', { vehicle_id: 1 })).double_counts).toBe(false);
  });
});
