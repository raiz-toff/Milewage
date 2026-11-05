import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { overrideDeductionMethod } from '../src/deduction-method';
import { addInterval } from '../src/time';
import { harness, type Harness } from './support';

// 18 section 5: expenses, categories, totals and recurring reminders.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const add = async (over: object = {}) =>
  (
    await send('POST', '/expenses', {
      spent_on: '2027-01-10',
      category: 'fuel',
      amount_cents: 5000,
      merchant: 'Shell',
      ...over,
    })
  ).json();

describe('create and read', () => {
  test('category defaults fill the flags; the deductible amount is computed and rounds half up', async () => {
    const fuel = await add();
    expect(fuel).toMatchObject({
      deductible: true,
      business_pct: 100,
      deductible_cents: 5000,
      double_counts: false,
      has_receipt: false,
    });
    const phone = await add({ category: 'phone', amount_cents: 1001 });
    expect([phone.business_pct, phone.deductible_cents]).toEqual([50, 501]); // 500.5 up
    const own = await add({ category: 'out_of_pocket' });
    expect([own.deductible, own.business_pct, own.deductible_cents]).toEqual([false, 0, 0]);
    const set = await add({ category: 'meals', business_pct: 25, amount_cents: 999 });
    expect(set.deductible_cents).toBe(250);
  });

  test('validation: category, dates, references, percentages and the tax credit', async () => {
    const bad: object[] = [
      { category: 'yachts' },
      { spent_on: '2027-02-30' },
      { amount_cents: 0 },
      { business_pct: 101 },
      { vehicle_id: 9 },
      { shift_id: 9 },
      { tax_credit_cents: 6000 },
      { recurrence: 'monthly' },
      { next_due: '2027-02-01' },
      { surprise: 1 },
    ];
    for (const b of bad) {
      const res = await send('POST', '/expenses', {
        spent_on: '2027-01-10',
        category: 'fuel',
        amount_cents: 5000,
        ...b,
      });
      expect(res.statusCode, JSON.stringify(b)).toBe(422);
    }
    expect((await h.call('GET', '/expenses')).statusCode).toBe(401);
  });

  test('patch changes only what is sent; delete; unknown ids are 404', async () => {
    const e = await add({ notes: 'keep me' });
    const patched = await send('PATCH', `/expenses/${e.id}`, {
      amount_cents: 6000,
      business_pct: 50,
    });
    expect(patched.json()).toMatchObject({
      amount_cents: 6000,
      notes: 'keep me',
      deductible_cents: 3000,
    });
    expect((await send('PATCH', `/expenses/${e.id}`, {})).statusCode).toBe(422);
    expect((await send('GET', `/expenses/${e.id}`)).json().merchant).toBe('Shell');
    expect((await send('DELETE', `/expenses/${e.id}`)).statusCode).toBe(204);
    for (const m of ['GET', 'DELETE'])
      expect((await send(m, `/expenses/${e.id}`)).statusCode).toBe(404);
  });
});

describe('list, totals, merchants', () => {
  test('filters, newest first and cursor pages', async () => {
    await add({ spent_on: '2027-01-02', category: 'fuel' });
    await add({ spent_on: '2027-01-05', category: 'parking', deductible: false });
    await add({ spent_on: '2027-01-09', category: 'fuel', merchant: 'Esso' });
    const ids = async (q: string) =>
      ((await send('GET', `/expenses${q}`)).json().items as { spent_on: string }[]).map(
        (x) => x.spent_on,
      );
    expect(await ids('')).toEqual(['2027-01-09', '2027-01-05', '2027-01-02']);
    expect(await ids('?category=fuel')).toEqual(['2027-01-09', '2027-01-02']);
    expect(await ids('?deductible=false')).toEqual(['2027-01-05']);
    expect(await ids('?from=2027-01-03&to=2027-01-06')).toEqual(['2027-01-05']);
    const first = (await send('GET', '/expenses?limit=2')).json();
    expect(first.items).toHaveLength(2);
    const second = (await send('GET', `/expenses?limit=2&cursor=${first.next_cursor}`)).json();
    expect([second.items.length, second.next_cursor]).toEqual([1, null]);
    expect((await send('GET', '/expenses?cursor=nope')).statusCode).toBe(422);
  });

  test('yearly totals: deductible against total spend, per category', async () => {
    await add({ category: 'fuel', amount_cents: 4000 });
    await add({ category: 'parking', amount_cents: 1000, deductible: false });
    await add({ category: 'meals', amount_cents: 2000 }); // 50 %
    await add({ spent_on: '2026-12-31', amount_cents: 9000 });
    const t = (await send('GET', '/expenses/totals?year=2027')).json();
    expect(t).toMatchObject({ year: 2027, total_cents: 7000, deductible_cents: 5000 });
    expect(t.by_category.map((c: { category: string }) => c.category)).toEqual([
      'fuel',
      'meals',
      'parking',
    ]);
    expect((await send('GET', '/expenses/totals')).json().year).toBe(2027); // the owner's current year
  });

  test('merchant autocomplete matches the start, case-insensitively, without wildcards', async () => {
    await add({ merchant: 'Shell' });
    await add({ merchant: 'Shoppers' });
    await add({ merchant: 'Esso' });
    expect((await send('GET', '/expenses/merchants?q=sh')).json().sort()).toEqual([
      'Shell',
      'Shoppers',
    ]);
    expect((await send('GET', '/expenses/merchants?q=%25')).json()).toEqual([]);
    expect((await send('GET', '/expenses/merchants')).json()).toHaveLength(3);
  });
});

describe('recurring reminders', () => {
  test('nothing is created by itself; confirming makes one occurrence and moves the template on', async () => {
    const t = await add({
      category: 'phone',
      recurrence: 'monthly',
      next_due: '2027-01-31',
      spent_on: '2026-12-31',
    });
    expect((await send('GET', '/expenses')).json().items).toEqual([]); // templates are not expenses
    expect((await send('GET', '/expenses?templates=true')).json().items).toHaveLength(1);
    h.clock.t = Date.UTC(2027, 0, 15, 18); // owner's local date: 2027-01-15 -> not due yet
    expect((await send('GET', '/expenses/due')).json()).toEqual([]);
    h.clock.t = Date.UTC(2027, 1, 1, 18);
    expect((await send('GET', '/expenses/due')).json().map((x: { id: number }) => x.id)).toEqual([
      t.id,
    ]);

    const occ = await send('POST', `/expenses/${t.id}/occurrences`, {
      spent_on: '2027-01-31',
      amount_cents: 4500,
    });
    expect(occ.statusCode).toBe(201);
    expect(occ.json()).toMatchObject({
      template_id: t.id,
      recurrence: null,
      amount_cents: 4500,
      category: 'phone',
    });
    const after = (await send('GET', `/expenses/${t.id}`)).json();
    expect(after.next_due).toBe('2027-02-28'); // a month end stays a month end
    expect((await send('GET', '/expenses/due')).json()).toEqual([]);
    expect((await send('GET', '/expenses')).json().items).toHaveLength(1);
    expect(
      (await send('POST', `/expenses/${occ.json().id}/occurrences`, { spent_on: '2027-02-01' }))
        .statusCode,
    ).toBe(422);
  });

  test('snooze hides it until the date; deleting the template keeps its occurrences', async () => {
    const t = await add({ recurrence: 'weekly', next_due: '2027-01-01' });
    h.clock.t = Date.UTC(2027, 0, 20, 18);
    expect((await send('GET', '/expenses/due')).json()).toHaveLength(1);
    expect(
      (await send('PUT', `/expenses/${t.id}/snooze`, { until: '2027-01-25' })).json().snoozed_until,
    ).toBe('2027-01-25');
    expect((await send('GET', '/expenses/due')).json()).toEqual([]);
    h.clock.t = Date.UTC(2027, 0, 25, 18);
    expect((await send('GET', '/expenses/due')).json()).toHaveLength(1);
    const occ = (
      await send('POST', `/expenses/${t.id}/occurrences`, { spent_on: '2027-01-25' })
    ).json();
    expect(occ.template_id).toBe(t.id);
    expect((await send('DELETE', `/expenses/${t.id}`)).statusCode).toBe(204);
    expect((await send('GET', `/expenses/${occ.id}`)).json().template_id).toBeNull();
    expect(
      (await send('PUT', `/expenses/${occ.id}/snooze`, { until: '2027-02-01' })).statusCode,
    ).toBe(422);
  });

  test('addInterval keeps month ends and leap days', () => {
    expect(addInterval('2027-01-31', 'monthly')).toBe('2027-02-28');
    expect(addInterval('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(addInterval('2028-02-29', 'yearly')).toBe('2029-02-28');
    expect(addInterval('2027-12-28', 'weekly')).toBe('2028-01-04');
    expect(addInterval('2027-11-30', 'monthly')).toBe('2027-12-30');
  });
});

describe('double counting with the standard mileage rate', () => {
  test('fuel on an automobile is flagged and left out of the deductible total; an ebike is not', async () => {
    await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    await send('POST', '/vehicles', { name: 'Bike', kind: 'ebike' });
    const car = await add({ vehicle_id: 1 });
    expect(car.double_counts).toBe(true);
    expect((await add({ vehicle_id: 1, category: 'parking' })).double_counts).toBe(false);
    expect((await add({ vehicle_id: 2 })).double_counts).toBe(false);
    expect((await add()).double_counts).toBe(false); // no vehicle
    const t = (await send('GET', '/expenses/totals?year=2027')).json();
    expect(t).toMatchObject({ deductible_cents: 10_000 + 5000, double_counts_cents: 5000 });
  });

  test('the method comes from the core seam, so an actual-expense vehicle is not flagged', async () => {
    await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    overrideDeductionMethod(h.db, () => 'actual_expenses');
    expect((await add({ vehicle_id: 1 })).double_counts).toBe(false);
    overrideDeductionMethod(h.db, undefined);
  });
});

describe('module off', () => {
  test('without the module there are no routes and the flag is false', async () => {
    const off = harness({ expenses: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', '/expenses', undefined, { cookie: c })).statusCode).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.expenses,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
