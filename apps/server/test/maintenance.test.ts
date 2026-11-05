import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

// 18 section 6: the service record, with its cost kept as one fact in one place.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const add = (b: object = {}) =>
  send('POST', '/vehicles/1/maintenance', { kind: 'oil_change', serviced_on: '2027-01-05', ...b });

describe('entries', () => {
  test('a cost creates a maintenance expense for the vehicle and the entry reads its cost from it', async () => {
    const res = await add({ cost_cents: 8900, odometer_m: 54_000_000 });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    expect(m).toMatchObject({
      kind: 'oil_change',
      cost_cents: 8900,
      odometer_m: 54_000_000,
      double_counts: true,
    });
    const expense = (await send('GET', `/expenses/${m.expense_id}`)).json();
    expect(expense).toMatchObject({
      category: 'maintenance',
      amount_cents: 8900,
      vehicle_id: 1,
      spent_on: '2027-01-05',
    });
    // the entry itself stores no cost: one fact in one place
    expect(
      h.db.prepare('SELECT cost_cents FROM maintenance_logs WHERE id = ?').pluck().get(m.id),
    ).toBeNull();
    // a change of cost is a change of the expense
    const p = await send('PATCH', `/maintenance/${m.id}`, {
      cost_cents: 9500,
      serviced_on: '2027-01-06',
    });
    expect(p.json().cost_cents).toBe(9500);
    expect((await send('GET', `/expenses/${m.expense_id}`)).json()).toMatchObject({
      amount_cents: 9500,
      spent_on: '2027-01-06',
    });
    expect((await send('PATCH', `/maintenance/${m.id}`, { cost_cents: 0 })).statusCode).toBe(422);
  });

  test('without a cost, with record_expense false, or on an actual-expense vehicle', async () => {
    const free = (await add()).json();
    expect([free.cost_cents, free.expense_id]).toEqual([null, null]);
    const own = (await add({ cost_cents: 4000, record_expense: false })).json();
    expect([own.cost_cents, own.expense_id, own.double_counts]).toEqual([4000, null, false]);
    expect((await send('GET', '/expenses')).json().items).toHaveLength(0);
    await send('PATCH', `/maintenance/${own.id}`, { cost_cents: 4500, notes: 'tyres' });
    expect(
      (await send('GET', '/vehicles/1/maintenance'))
        .json()
        .find((x: { id: number }) => x.id === own.id),
    ).toMatchObject({ cost_cents: 4500, notes: 'tyres' });
    await send('PUT', '/vehicles/1/tax-years/2027', { method: 'actual_expenses' });
    expect((await add({ cost_cents: 100 })).json().double_counts).toBe(false);
  });

  test('list is newest first; deleting an entry keeps the expense', async () => {
    const a = (await add({ serviced_on: '2027-01-02', cost_cents: 100 })).json();
    await add({ serviced_on: '2027-01-09', kind: 'tires' });
    expect(
      (await send('GET', '/vehicles/1/maintenance')).json().map((x: { kind: string }) => x.kind),
    ).toEqual(['tires', 'oil_change']);
    expect((await send('DELETE', `/maintenance/${a.id}`)).statusCode).toBe(204);
    expect((await send('GET', `/expenses/${a.expense_id}`)).statusCode).toBe(200);
    expect((await send('DELETE', `/maintenance/${a.id}`)).statusCode).toBe(404);
  });

  test('validation and ownership', async () => {
    for (const bad of [
      { kind: 'wash' },
      { serviced_on: 'yesterday' },
      { cost_cents: -1 },
      { x: 1 },
    ]) {
      expect((await add(bad)).statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect(
      (await send('POST', '/vehicles/9/maintenance', { kind: 'other', serviced_on: '2027-01-01' }))
        .statusCode,
    ).toBe(404);
    expect((await send('GET', '/vehicles/9/maintenance')).statusCode).toBe(404);
    expect((await h.call('GET', '/vehicles/1/maintenance')).statusCode).toBe(401);
  });
});

describe('modules', () => {
  test('without expenses a cost is stored on the entry itself', async () => {
    const off = harness({ expenses: false, receipts: false });
    try {
      const { cookie: c } = await off.signUp();
      await off.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie: c });
      const r = await off.call(
        'POST',
        '/vehicles/1/maintenance',
        { kind: 'brakes', serviced_on: '2027-01-05', cost_cents: 700 },
        { cookie: c },
      );
      expect(r.json()).toMatchObject({ cost_cents: 700, expense_id: null });
    } finally {
      await off.close();
    }
  });

  test('maintenance off: routes are 404 and the flag is false', async () => {
    const off = harness({ maintenance: false });
    try {
      const { cookie: c } = await off.signUp();
      expect(
        (await off.call('GET', '/vehicles/1/maintenance', undefined, { cookie: c })).statusCode,
      ).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.maintenance,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
