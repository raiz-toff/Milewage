import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { caCountry, estimateTax, type TaxEstimate, type TaxInput } from '@milewage/shared';
import { harness, type Harness } from './support';

// 18 section 7: the Tax Center. CA only; the figures are unverified and say so.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await send('PATCH', '/settings', { country: 'CA', region: 'ON' });
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';

/** One 2026 shift of 100 km with CAD 80 000 of earnings, and three expenses. */
async function seed() {
  const id = (
    await send('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: h.clock.t })
  ).json().id;
  h.db
    .prepare(
      "UPDATE shifts SET status = 'ended', ended_at = ?, total_m = 100000, local_date = '2026-03-01' WHERE id = ?",
    )
    .run(h.clock.t + 3_600_000, id);
  await send('PUT', `/shifts/${id}/earnings/doordash`, {
    gross_cents: 7_000_000,
    tips_cents: 500_000,
    bonus_cents: 500_000,
  });
  const exp = (b: object) =>
    send('POST', '/expenses', {
      spent_on: '2026-04-01',
      amount_cents: 1000,
      category: 'fuel',
      ...b,
    });
  await exp({ category: 'phone', amount_cents: 10_000 }); // 50 % -> 5 000
  await exp({ category: 'parking', amount_cents: 2000, tax_credit_cents: 200 }); // 2 000
  await exp({ category: 'fuel', amount_cents: 5000, vehicle_id: 1 }); // covered by the standard rate
  return id as number;
}
const year = async (q = '') => (await send('GET', `/tax/2026${q}`)).json();

describe('the estimate', () => {
  test('taxable income, CPP and CPP2, set-aside, instalment, slip alert and deadlines, every line', async () => {
    await seed();
    const t = await year();
    expect(t).toMatchObject({
      supported: true,
      unverified: true,
      country: 'CA',
      set_aside_bp: 2500,
      sales_tax_name: 'HST', // Ontario, from the country data
      income: {
        gross_cents: 7_000_000,
        tips_cents: 500_000,
        bonus_cents: 500_000,
        total_cents: 8_000_000,
      },
      deductions: { expenses_cents: 7000, double_counted_cents: 5000, mileage_cents: 7300 },
    });
    expect(t.estimate).toMatchObject({
      net_income_cents: 7_985_700,
      taxable_income_cents: 7_985_700,
      lines: [
        { key: 'pension_contribution', cents: 846_090, note: null }, // (74 600 - 3 500) x 11.90 %
        { key: 'pension_contribution_second_band', cents: 42_056 }, // (79 857 - 74 600) x 8 %
        { key: 'income_tax_set_aside', label: 'Income tax at 25%', cents: 1_996_425 },
      ],
      total_set_aside_cents: 2_884_571,
      instalment_cents: 721_143,
      sales_tax: null,
    });
    expect(t.slip_alerts).toEqual([
      { platform: 'doordash', total_cents: 8_000_000, threshold_cents: 50_000, slip: 'T4A' },
    ]);
    expect(t.deadlines.map((d: { date: string }) => d.date)).toEqual([
      '2026-03-15',
      '2026-06-15',
      '2026-09-15',
      '2026-12-15',
      '2027-04-30',
      '2027-06-15',
    ]);
    expect(t.notices.join(' ')).toMatch(/Unverified rates/);
    expect(t.notices.join(' ')).toMatch(/not tax advice/);
  });

  test('inputs: the set-aside rate and registration change the estimate; sales tax uses the typed amount', async () => {
    await seed();
    await send('PUT', '/tax/2026', { set_aside_bp: 3000, sales_tax_registered: true });
    const t = await year('?collected_cents=100000');
    expect(t.estimate.lines[2]).toMatchObject({ key: 'income_tax_set_aside', cents: 2_395_710 });
    expect(t.estimate.sales_tax).toEqual({
      collected_cents: 100_000,
      credits_cents: 200, // only the parking expense carries a credit; the double-counted fuel is out
      owing_cents: 99_800,
      rate_bp: 1300, // Ontario HST
    });
    expect((await send('PUT', '/tax/2026', { set_aside_bp: 20_000 })).statusCode).toBe(422);
    expect((await send('PUT', '/tax/2026', {})).statusCode).toBe(422);
    expect((await send('GET', '/tax/1999')).statusCode).toBe(422);
  });

  test('no earnings means no estimate, never a zero one; a year without CPP figures says so', async () => {
    const empty = await year();
    expect([empty.income, empty.estimate]).toEqual([null, null]);
    expect(empty.notices.join(' ')).toMatch(/No earnings/);
    await seed();
    const old = (await send('GET', '/tax/2024')).json();
    expect(old.estimate).toBeNull(); // the shift is in 2026
  });

  test('a country without a pack is unsupported; the tax countries setting is not code', async () => {
    await send('PATCH', '/settings', { country: 'US' });
    const us = await year();
    expect(us).toMatchObject({ supported: false, estimate: null, income: null, deadlines: [] });
    expect(us.sales_tax_name).toBeNull();
    expect(us.notices[0]).toMatch(/No tax estimate/);
    const off = harness({}, { comma: { taxCountries: [] } });
    try {
      const { cookie: c } = await off.signUp();
      await off.call('PATCH', '/settings', { country: 'CA' }, { cookie: c });
      const t = (await off.call('GET', '/tax/2026', undefined, { cookie: c })).json();
      expect(t.supported).toBe(false); // CA switched off by configuration
    } finally {
      await off.close();
    }
  });

  test('tax countries can only hide a pack: listing a country without one shows nothing', async () => {
    const on = harness({}, { comma: { taxCountries: ['CA', 'US', 'GB'] } });
    try {
      const { cookie: c } = await on.signUp();
      for (const country of ['US', 'GB']) {
        await on.call('PATCH', '/settings', { country }, { cookie: c });
        const t = (await on.call('GET', '/tax/2026', undefined, { cookie: c })).json();
        expect([country, t.supported, t.deadlines]).toEqual([country, false, []]);
      }
    } finally {
      await on.close();
    }
  });
});

describe('how a vehicle is deducted', () => {
  test('actual expenses: no mileage value in the shift and the summary, and fuel counts as an expense', async () => {
    await seed();
    const shifts = async () => (await send('GET', '/shifts?limit=5')).json().items[0];
    expect((await shifts()).deduction_cents).toBe(7300);
    const put = await send('PUT', '/vehicles/1/tax-years/2026', { method: 'actual_expenses' });
    expect(put.json()).toMatchObject({ method: 'actual_expenses', source: 'saved' });
    expect((await shifts()).deduction_cents).toBeNull();
    const t = await year();
    expect(t.deductions).toMatchObject({
      expenses_cents: 12_000,
      double_counted_cents: 0,
      mileage_cents: null,
    });
    const summary = (await send('GET', '/summary?from=2026-01-01&to=2026-12-31')).json();
    expect(summary.deduction_cents).toBeNull();
    const expense = (await send('GET', '/expenses?category=fuel')).json().items[0];
    expect(expense.double_counts).toBe(false);

    expect((await send('DELETE', '/vehicles/1/tax-years/2026')).statusCode).toBe(204);
    expect((await send('GET', '/vehicles/1/tax-years/2026')).json()).toMatchObject({
      method: 'standard_mileage',
      source: 'default',
    });
    expect((await shifts()).deduction_cents).toBe(7300);
    expect((await send('GET', '/vehicles/9/tax-years/2026')).statusCode).toBe(404);
    expect((await send('PUT', '/vehicles/1/tax-years/2026', { method: 'barter' })).statusCode).toBe(
      422,
    );
  });
});

describe('Tax Jar', () => {
  test('quick-add, withdraw, balance against the target, delete', async () => {
    await seed();
    await send('POST', '/tax/2026/jar', { amount_cents: 100_000 });
    const jar = await send('POST', '/tax/2026/jar', {
      amount_cents: -25_000,
      entered_on: '2026-06-01',
      note: 'paid',
    });
    expect(jar.statusCode).toBe(201);
    expect(jar.json()).toMatchObject({ balance_cents: 75_000, target_cents: 2_000_000 });
    expect(jar.json().entries).toHaveLength(2);
    expect((await send('POST', '/tax/2026/jar', { amount_cents: 0 })).statusCode).toBe(422);
    const id = jar.json().entries[0].id;
    expect((await send('DELETE', `/tax/jar/${id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/tax/jar/${id}`)).statusCode).toBe(404);
    expect((await send('GET', '/tax/2026/jar')).json().entries).toHaveLength(1);
    expect((await send('GET', '/tax/2025/jar')).json().balance_cents).toBe(0); // per year
  });
});

describe('module off', () => {
  test('without tax: no routes, mileage as today, flag false', async () => {
    const off = harness({ tax: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', '/tax/2026', undefined, { cookie: c })).statusCode).toBe(404);
      expect(
        (await off.call('GET', '/vehicles/1/tax-years/2026', undefined, { cookie: c })).statusCode,
      ).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.tax,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});

describe('the pack arithmetic (shared)', () => {
  const base: TaxInput = {
    year: 2026,
    region: 'ON',
    incomeCents: 5_000_000,
    expensesCents: 0,
    mileageCents: 0,
    setAsideBp: 2000,
    salesTaxRegistered: false,
    collectedCents: 0,
    creditCents: 0,
  };
  const est = (i: TaxInput) => estimateTax(caCountry, i)!;
  const pension = (e: TaxEstimate) => [e.lines[0]!.cents, e.lines[1]!.cents, e.lines[0]!.note];
  test('lines add up to the total and the instalment is a quarter of it', () => {
    const e = est(base);
    expect(e.lines.reduce((a, l) => a + (l.cents ?? 0), 0)).toBe(e.total_set_aside_cents);
    expect(e.instalment_cents).toBe(Math.floor(e.total_set_aside_cents / 4 + 0.5));
  });
  test('below the exemption nothing is contributed; a loss is not negative tax', () => {
    expect(pension(est({ ...base, incomeCents: 300_000 }))).toEqual([0, 0, null]);
    const loss = est({ ...base, incomeCents: 100_000, expensesCents: 400_000 });
    expect([loss.net_income_cents, loss.taxable_income_cents, loss.total_set_aside_cents]).toEqual([
      -300_000, 0, 0,
    ]);
  });
  test('Quebec and years without figures leave the contribution out and say why', () => {
    expect(pension(est({ ...base, region: 'QC' }))).toEqual([
      null,
      null,
      'Region QC has its own pension plan; it is not estimated here.',
    ]);
    expect(pension(est({ ...base, year: 2023 }))).toEqual([
      null,
      null,
      'The pack has no contribution figures for 2023.',
    ]);
    expect(pension(est({ ...base, year: 2027 }))[2]).toContain('2027'); // the figures end with 2026
    expect(caCountry.tax?.verified).toBe(false);
  });
  test('other provinces use their own sales tax rate', () => {
    const r = (region: string) =>
      est({ ...base, region, salesTaxRegistered: true }).sales_tax?.rate_bp;
    expect([r('NS'), r('AB'), r('ON')]).toEqual([1500, 500, 1300]);
  });
});
