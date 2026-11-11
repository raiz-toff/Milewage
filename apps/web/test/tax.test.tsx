// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, pick, DASHBOARD } from './support/kit';
import { createQueryClient } from '../src/api/query';
import { formatDay } from '../src/days';

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
  sales_tax_name: 'HST',
  notices: [
    'Unverified rates: these figures have not been checked against the CRA publications.',
    'Estimates to bring to an accountant, not tax advice. Nothing here is filed.',
  ],
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
  // Out of order on purpose; one past, the next is an instalment, then the balance.
  deadlines: [
    { date: `${YEAR + 1}-04-30`, kind: 'balance', label: 'Balance due' },
    { date: `${YEAR - 1}-12-15`, kind: 'instalment', label: 'Instalment 4' },
    { date: `${YEAR + 1}-03-15`, kind: 'instalment', label: 'Instalment 1' },
  ],
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
      [`GET /tax/${YEAR - 1}`]: () => ({ body: { ...r, year: YEAR - 1 } }),
      [`GET /tax/${YEAR - 1}/jar`]: () => ({ body: { ...jar(), year: YEAR - 1 } }),
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
  it('leads with what to set aside and the next date, under one notice', async () => {
    open();
    const hero = await screen.findByRole('region', { name: 'Estimate' });
    expect(screen.getByRole('heading', { name: `Set aside for ${YEAR}` })).toBeTruthy();
    expect(hero.textContent).toContain('$1,575.00');
    // The next date in the driver's locale (en-CA), with the quarter's amount.
    const day = formatDay(`${YEAR + 1}-03-15`, 'en-CA');
    expect(hero.textContent).toContain(`Next: Instalment 1, ${day}, $393.75`);
    // One note with the server's notices; no banner of its own, and nothing repeated.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getAllByText(/Unverified rates/)).toHaveLength(1);
    expect(screen.getByRole('note').textContent).toMatch(/CRA publications\. .*not tax advice/);
    // Deadlines in date order: the past one muted and marked, the next one badged.
    const items = within(screen.getByRole('region', { name: 'Deadlines' })).getAllByRole(
      'listitem',
    );
    expect(items.map((i) => i.textContent)).toEqual([
      `${formatDay(`${YEAR - 1}-12-15`, 'en-CA')}Instalment 4 (past)`,
      expect.stringMatching(new RegExp(`^${day}Instalment 1Nextin \\d+ days$`)),
      `${formatDay(`${YEAR + 1}-04-30`, 'en-CA')}Balance due`,
    ]);
    expect(items[0]!.className).toMatch(/text-muted-foreground/);
    // The alert names the platform as the driver knows it, not by its slug.
    expect(screen.getByText(/expect a T4A/).textContent).toMatch(/^DoorDash: /);
  });

  it('folds the working, the settings and the jar entries under Details', async () => {
    open();
    const details = await screen.findByRole('region', { name: 'Details' });
    const summaries = [...details.querySelectorAll('summary')].map((x) => x.textContent);
    expect(summaries[0]).toMatch(/^How this is worked outTaxable income \$6,300\.00/);
    expect(summaries[1]).toMatch(/^Tax settingsSet aside 25%; not registered for HST/);
    expect(details.querySelectorAll('details[open]')).toHaveLength(0);
    // A $0.00 line is muted, not hidden.
    expect(screen.getByRole('row', { name: /Pension, second band.*\$0\.00/ }).className).toMatch(
      /text-muted-foreground/,
    );
  });

  it('steps between tax years with arrows, not a free text field', async () => {
    const s = open();
    await screen.findByRole('heading', { name: `Set aside for ${YEAR}` });
    expect(screen.queryByLabelText('Tax year')?.tagName).not.toBe('INPUT');
    fireEvent.click(screen.getByRole('button', { name: 'Previous tax year' }));
    expect(await screen.findByRole('heading', { name: `Set aside for ${YEAR - 1}` })).toBeTruthy();
    expect(s.calls.some((c) => c.path === `/tax/${YEAR - 1}`)).toBe(true);
  });

  it('shows the working line by line', async () => {
    open();
    await screen.findByRole('heading', { name: `Set aside for ${YEAR}` });
    expect(screen.getByText(/Mileage deduction \(a deduction, not cash\)/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /Taxable income.*\$6,300\.00/ })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Quarterly instalment.*\$393\.75/ })).toBeTruthy();
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

  it('shows platform fees and withheld tax only when there are some (plan 22)', async () => {
    open();
    await screen.findByRole('heading', { name: `Set aside for ${YEAR}` });
    expect(screen.queryByText(/Platform fees|Tax withheld/)).toBeNull();
    cleanup();
    const base = report();
    open(
      report({
        income: { ...base.income, fees_cents: -20_000, tax_withheld_cents: -3000 },
      }),
    );
    expect(
      await screen.findByRole('row', { name: /Platform fees \(already taken off\).*-\$200\.00/ }),
    ).toBeTruthy();
    expect(screen.getByRole('row', { name: /Tax withheld by platforms.*\$30\.00/ })).toBeTruthy();
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
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText('Set-aside rate (%)')).toBeNull();
  });

  it('saves the set-aside rate as basis points and the registration flag', async () => {
    const s = open();
    const rate = (await screen.findByLabelText('Set-aside rate (%)')) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual({ set_aside_bp: 3000 });
    // The sales tax is named from the country data of the driver's place, not by the screen.
    fireEvent.click(screen.getByLabelText('Registered for HST'));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(s.calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({
      sales_tax_registered: true,
    });
  });

  it('adds to the jar in cents and deletes an entry', async () => {
    const s = open();
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to jar' }));
    const jar = screen.getByRole('region', { name: 'Tax jar' });
    await waitFor(() => expect(jar.textContent).toContain('$50.00of $1,750.00$1,700.00 to go'));
    expect(screen.getByRole('progressbar', { name: 'Tax jar' }).getAttribute('aria-valuenow')).toBe(
      '3',
    );
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({ amount_cents: 5000 });
    fireEvent.click(screen.getByText('Tax jar entries'));
    fireEvent.click(screen.getByRole('button', { name: /Delete jar entry/ }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('is absent when the module is off', async () => {
    const s = open(report(), false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tax' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/tax'))).toBe(false);
  });

  it('shows the new estimate after an expense is added on the Expenses page', async () => {
    // The server works the estimate out from expenses; a cache that keeps answers, as the
    // browser's does, would otherwise show the old figure for 30 s.
    let current = report();
    renderApp(
      {
        ...signedIn(),
        [`GET /tax/${YEAR}`]: () => ({ body: current }),
        [`GET /tax/${YEAR}/jar`]: () => ({ body: jar() }),
        'GET /expenses': () => ({ body: { items: [], next_cursor: null } }),
        'GET /expenses/totals': () => ({
          body: { year: YEAR, total_cents: 0, deductible_cents: 0, double_counts_cents: 0 },
        }),
        'GET /expenses/due': () => ({ body: [] }),
        'GET /expenses/categories': () => ({ body: [] }),
        'GET /vehicles': () => ({ body: [] }),
        'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
        'POST /expenses': () => {
          current = report({
            estimate: { ...report().estimate, total_set_aside_cents: 150_000 },
          });
          return { status: 201, body: {} };
        },
      },
      '/tax',
      createQueryClient({ retry: false }),
    );
    const hero = await screen.findByRole('region', { name: 'Estimate' });
    expect(hero.textContent).toContain('$1,575.00');
    fireEvent.click(screen.getByRole('link', { name: 'Expenses' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(screen.queryByText('New expense')).toBeNull());
    fireEvent.click(screen.getByRole('link', { name: 'Tax' }));
    const again = await screen.findByRole('region', { name: 'Estimate' });
    await waitFor(() => expect(again.textContent).toContain('$1,500.00'));
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
    pick(await screen.findByLabelText(/deduction for Corolla/), 'actual_expenses');
    await waitFor(() => expect(on.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(on.calls.find((c) => c.method === 'PUT')?.body).toEqual({ method: 'actual_expenses' });
    cleanup();
    const off = mk(false);
    await screen.findByText('Corolla');
    expect(screen.queryByLabelText(/deduction for Corolla/)).toBeNull();
    expect(off.calls.some((c) => c.path.includes('tax-years'))).toBe(false);
  });
});
