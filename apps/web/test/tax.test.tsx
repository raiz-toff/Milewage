// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, pick } from './support/kit';

afterEach(cleanup);

const YEAR = new Date().getFullYear();
const report = (over: object = {}) => ({
  year: YEAR,
  country: 'CA',
  region: 'ON',
  supported: true,
  unverified: true,
  set_aside_bp: 2500,
  sales_tax_registered: false,
  notices: ['Estimates to bring to an accountant, not tax advice. Nothing here is filed.'],
  income: {
    gross_cents: 700_000,
    tips_cents: 0,
    bonus_cents: 0,
    total_cents: 700_000,
    by_platform: [],
  },
  deductions: {
    expenses_cents: 50_000,
    double_counted_cents: 0,
    mileage_cents: 20_000,
    vehicles: [],
  },
  estimate: {
    net_income_cents: 630_000,
    taxable_income_cents: 630_000,
    lines: [
      {
        key: 'pension_contribution',
        label: 'Pension contribution (self-employed)',
        cents: 0,
        note: null,
      },
      {
        key: 'pension_contribution_second_band',
        label: 'Pension, second band',
        cents: 0,
        note: null,
      },
      { key: 'income_tax_set_aside', label: 'Income tax at 25%', cents: 157_500, note: null },
    ],
    total_set_aside_cents: 157_500,
    instalment_cents: 39_375,
    sales_tax: null,
  },
  deadlines: [{ date: `${YEAR}-03-15`, kind: 'instalment', label: 'Instalment 1' }],
  slip_alerts: [
    { platform: 'doordash', total_cents: 700_000, threshold_cents: 50_000, slip: 'T4A' },
  ],
  jar: { balance_cents: 0, target_cents: 175_000 },
  ...over,
});
const jar = (entries: object[] = []) => ({
  year: YEAR,
  balance_cents: entries.length ? 5000 : 0,
  target_cents: 175_000,
  entries,
});

function open(r = report(), enabled = true) {
  let entries: object[] = [];
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { tax: enabled } })),
      [`GET /tax/${YEAR}`]: () => ({ body: r }),
      [`PUT /tax/${YEAR}`]: () => ({ body: r }),
      [`GET /tax/${YEAR}/jar`]: () => ({ body: jar(entries) }),
      [`POST /tax/${YEAR}/jar`]: () => {
        entries = [{ id: 1, amount_cents: 5000, entered_on: `${YEAR}-02-01`, note: null }];
        return { status: 201, body: jar(entries) };
      },
      'DELETE /tax/jar/1': () => {
        entries = [];
        return { status: 204 };
      },
    },
    '/tax',
  );
}

describe('tax screen (module tax)', () => {
  it('shows the working, the unverified-rates notice, deadlines and slip alerts', async () => {
    open();
    expect(await screen.findByRole('heading', { name: `Estimate for ${YEAR}` })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Unverified rates/);
    expect(screen.getAllByText(/not tax advice/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mileage deduction \(a deduction, not cash\)/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /Taxable income.*\$6,300\.00/ })).toBeTruthy();
    expect(screen.getByText('Instalment 1')).toBeTruthy();
    expect(screen.getByText(/expect a T4A/)).toBeTruthy();
  });

  it("shows the country's lines as they come, with the note of a line not estimated", async () => {
    const lines: { key: string; label: string; cents: number | null; note: string | null }[] = [
      {
        key: 'pension_contribution',
        label: 'Pension contribution (self-employed)',
        cents: null,
        note: 'Region QC has its own pension plan; it is not estimated here.',
      },
      {
        key: 'pension_contribution_second_band',
        label: 'Pension, second band',
        cents: null,
        note: null,
      },
      { key: 'some_other_levy', label: 'Some other levy', cents: 1234, note: null },
    ];
    const r = report();
    open({ ...r, estimate: { ...r.estimate, lines } } as unknown as typeof r);
    expect(
      await screen.findByRole('row', { name: /Pension contribution.*own pension plan/ }),
    ).toBeTruthy();
    expect(screen.getByRole('row', { name: /Pension, second band.*—/ })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Some other levy.*\$12\.34/ })).toBeTruthy();
  });

  it('says so, and shows no estimate, for a country without a pack', async () => {
    open(
      report({
        supported: false,
        estimate: null,
        income: null,
        deductions: null,
        deadlines: [],
        slip_alerts: [],
        notices: ['No tax estimate is available for US yet.'],
      }),
    );
    expect(await screen.findByText(/No tax estimate is available for US/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Estimate' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull(); // the "unverified" banner is for an estimate that is shown
  });

  it('saves the set-aside rate as basis points and the registration flag', async () => {
    const s = open();
    const rate = (await screen.findByLabelText('Set-aside rate (%)')) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual({ set_aside_bp: 3000 });
    fireEvent.click(screen.getByLabelText('Registered for GST/HST'));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(s.calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({
      sales_tax_registered: true,
    });
  });

  it('quick-adds to the jar in cents and deletes an entry', async () => {
    const s = open();
    fireEvent.click(await screen.findByRole('button', { name: '+ $50.00' }));
    await screen.findByText(/Set aside \$50\.00 of \$1,750\.00 target/);
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({ amount_cents: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /Delete jar entry/ }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('is absent when the module is off', async () => {
    const s = open(report(), false);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tax' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/tax'))).toBe(false);
  });
});

describe('vehicle tax-year panel', () => {
  it('chooses actual expenses for the year; absent with the module off', async () => {
    const vehicle = {
      id: 1,
      name: 'Corolla',
      kind: 'car',
      make: null,
      model: null,
      year: null,
      plate: null,
      power: null,
      created_at: 1,
      archived_at: null,
    };
    const mk = (tax: boolean) =>
      renderApp(
        {
          ...signedIn(settingsFixture({ modules: { tax } })),
          'GET /vehicles': () => ({ body: [vehicle] }),
          [`GET /vehicles/1/tax-years/${YEAR}`]: () => ({
            body: {
              vehicle_id: 1,
              tax_year: YEAR,
              method: 'standard_mileage',
              source: 'default',
              rate1_milli: null,
              rate2_milli: null,
              threshold_m: null,
            },
          }),
          [`PUT /vehicles/1/tax-years/${YEAR}`]: ({ body }) => ({
            body: {
              vehicle_id: 1,
              tax_year: YEAR,
              method: (body as { method: string }).method,
              source: 'saved',
              rate1_milli: null,
              rate2_milli: null,
              threshold_m: null,
            },
          }),
        },
        '/vehicles',
      );
    const on = mk(true);
    pick(await screen.findByLabelText(/Deduct Corolla in/), 'actual_expenses');
    await waitFor(() => expect(on.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(on.calls.find((c) => c.method === 'PUT')?.body).toEqual({ method: 'actual_expenses' });
    cleanup();
    const off = mk(false);
    await screen.findByText('Corolla');
    expect(screen.queryByLabelText(/Deduct Corolla in/)).toBeNull();
    expect(off.calls.some((c) => c.path.includes('tax-years'))).toBe(false);
  });
});
