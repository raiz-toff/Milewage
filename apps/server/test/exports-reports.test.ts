import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

// 18 section 10.3: the expenses and tax_summary exporters.
let h: Harness;
let cookie: string;
const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await send('PATCH', '/settings', { country: 'CA', region: 'ON' });
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
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
  await exp({ category: 'phone', amount_cents: 10_000, merchant: '=cmd|calc' });
  await exp({ category: 'fuel', amount_cents: 5000, vehicle_id: 1, shift_id: id, notes: 'a, "b"' });
  await exp({ spent_on: '2025-01-01', category: 'parking', amount_cents: 700 });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const lines = (body: string) => body.split('\r\n').filter(Boolean);

describe('expenses CSV', () => {
  test('columns, rounding, the standard-rate marker, quoting, and the formula guard', async () => {
    const res = await send('GET', '/exports/expenses?from=2026-01-01&to=2026-12-31');
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain(
      'milewage-expenses-2026-01-01_2026-12-31.csv',
    );
    const rows = lines(res.body);
    expect(rows[0]).toBe(
      'Date,Category,Merchant,Amount,Deductible,Business_Use_Pct,Deductible_Amount,Tax_Credit,Vehicle,Shift_Date,Receipt,Recurring,Notes,Covered_By_Mileage_Rate',
    );
    expect(rows).toHaveLength(3); // the 2025 expense is outside the range
    expect(rows[1]).toBe("2026-04-01,Phone,'=cmd|calc,100.00,yes,50,50.00,0.00,,,no,no,,no");
    expect(rows[2]).toBe(
      '2026-04-01,Fuel,,50.00,yes,100,0.00,0.00,Civic,2026-03-01,no,no,"a, ""b""",yes',
    );
  });

  test('default is the current year, a category filter narrows it, bad ranges are 422', async () => {
    // The clock says 2027: the default year has no expenses; year=2025 holds the parking one.
    expect(lines((await send('GET', '/exports/expenses')).body)).toHaveLength(1);
    expect(lines((await send('GET', '/exports/expenses?year=2025')).body)).toHaveLength(2);
    expect(
      lines((await send('GET', '/exports/expenses?year=2026&category=phone')).body),
    ).toHaveLength(2);
    expect((await send('GET', '/exports/expenses?from=2026-05-01&to=2026-04-01')).statusCode).toBe(
      422,
    );
    expect((await send('GET', '/exports/expenses?format=xml')).statusCode).toBe(422);
  });
});

describe('tax summary', () => {
  test('CSV carries the disclaimer, the unverified notice, the lines and the deadlines', async () => {
    const res = await send('GET', '/exports/tax_summary?year=2026');
    expect(res.headers['content-disposition']).toContain('milewage-tax_summary-2026.csv');
    const rows = lines(res.body);
    expect(rows[0]).toBe('Section,Item,Value');
    expect(rows).toContain(
      'Notice,Disclaimer,"Estimate to bring to an accountant, not tax advice. Nothing here is filed."',
    );
    expect(rows.some((r) => r.startsWith('Notice,Rates,Unverified rates'))).toBe(true);
    for (const expected of [
      'Income,Gross,70000.00',
      'Income_By_Platform,doordash,80000.00',
      'Deductible_Expenses,phone,50.00',
      'Vehicle,Civic method,standard_mileage',
      'Mileage_Deduction,Civic,73.00',
      'Estimate,Taxable_Income,79877.00',
      'Estimate,Pension_Contribution,8460.90',
      'Estimate,Total_Set_Aside,28852.31',
      'Jar,Balance,0.00',
      'Deadline,Self-employed filing,2027-06-15',
    ]) {
      expect(rows, expected).toContain(expected);
    }
    expect(rows.some((r) => r.startsWith('Deductible_Expenses,fuel'))).toBe(false); // covered by the mileage rate
  });

  test('JSON is the report with its working and the disclaimer', async () => {
    const res = await send('GET', '/exports/tax_summary?year=2026&format=json');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    const j = res.json();
    expect(j).toMatchObject({
      year: 2026,
      supported: true,
      unverified: true,
      expenses_by_category: [{ category: 'phone', deductible_cents: 5000 }],
      vehicles: [{ vehicle: 'Civic', method: 'standard_mileage', mileage_deduction_cents: 7300 }],
    });
    expect(j.disclaimer).toMatch(/not tax advice/);
  });

  test('an unsupported country exports the notice and nothing invented', async () => {
    await send('PATCH', '/settings', { country: 'US' });
    const rows = lines((await send('GET', '/exports/tax_summary?year=2026')).body);
    expect(rows.some((r) => r.startsWith('Notice,Estimate,No tax estimate'))).toBe(true);
    expect(rows.some((r) => r.startsWith('Income'))).toBe(false);
  });
});

describe('switches and modules', () => {
  test('each format has its own switch and requires its module', async () => {
    const off = harness({}, { enabledExportFormats: () => ['csv', 'expenses'] });
    const noTax = harness({ tax: false });
    try {
      const a = await off.signUp();
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: a.cookie })).json().modules
          .exporters,
      ).toEqual(['csv', 'expenses']);
      expect(
        (await off.call('GET', '/exports/tax_summary', undefined, { cookie: a.cookie })).statusCode,
      ).toBe(404);
      const b = await noTax.signUp();
      const formats = (await noTax.call('GET', '/settings', undefined, { cookie: b.cookie })).json()
        .modules.exporters;
      expect(formats).toEqual(['csv', 'gpx', 'geojson', 'expenses']);
      expect(
        (await noTax.call('GET', '/exports/tax_summary', undefined, { cookie: b.cookie }))
          .statusCode,
      ).toBe(404);
    } finally {
      await off.close();
      await noTax.close();
    }
  });
});
