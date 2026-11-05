// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { bodyOf } from '../src/pages/Expenses';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const cat = (slug: string, label: string, over: object = {}) => ({
  slug,
  label,
  default_deductible: true,
  default_business_pct: 100,
  vehicle_related: false,
  covered_by_standard_rate: false,
  ...over,
});
const CATS = [cat('fuel', 'Fuel'), cat('meals', 'Meals', { default_business_pct: 50 })];
const expense = (over: object = {}) => ({
  id: 1,
  spent_on: '2023-11-14',
  category: 'fuel',
  amount_cents: 5000,
  merchant: 'Shell',
  deductible: true,
  business_pct: 100,
  tax_credit_cents: 0,
  vehicle_id: null,
  shift_id: null,
  notes: null,
  recurrence: null,
  next_due: null,
  snoozed_until: null,
  template_id: null,
  deductible_cents: 5000,
  double_counts: false,
  has_receipt: false,
  created_at: 1,
  updated_at: 1,
  ...over,
});
const totals = {
  year: 2023,
  total_cents: 5000,
  deductible_cents: 4000,
  double_counts_cents: 0,
  by_category: [],
};

function open(rows = [expense()], due: object[] = [], enabled = true) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { expenses: enabled } })),
      'GET /expenses': () => ({ body: { items: rows, next_cursor: null } }),
      'GET /expenses/totals': () => ({ body: totals }),
      'GET /expenses/due': () => ({ body: due }),
      'GET /expenses/categories': () => ({ body: CATS }),
      'GET /expenses/merchants': () => ({ body: ['Shell'] }),
      'GET /vehicles': () => ({ body: [] }),
      'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
      'POST /expenses': () => ({ status: 201, body: expense({ id: 2 }) }),
      'POST /expenses/9/occurrences': () => ({ status: 201, body: expense({ id: 3 }) }),
      'PUT /expenses/9/snooze': () => ({ body: expense({ id: 9 }) }),
      'DELETE /expenses/1': () => ({ status: 204 }),
    },
    '/expenses',
  );
}

describe('expenses screen (module expenses)', () => {
  it('shows the year tiles and the list with deductible amounts', async () => {
    open();
    expect(await screen.findByText('Shell')).toBeTruthy();
    expect(screen.getByLabelText('Year to date').textContent).toMatch(/\$40\.00.*\$50\.00/);
  });

  it('flags a cost the mileage rate already covers', async () => {
    open([expense({ double_counts: true })]);
    expect(await screen.findByText('covered by the mileage rate')).toBeTruthy();
  });

  it('adds an expense: the category sets the business share, quick picks change it, cents are sent', async () => {
    const s = open();
    await screen.findByText('Shell');
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Meals' }));
    expect(screen.getByRole('button', { name: '50%', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.30' } });
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Tim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.method === 'POST' && c.path === '/expenses')).toBe(true),
    );
    expect(s.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      category: 'meals',
      amount_cents: 1230,
      business_pct: 75,
      merchant: 'Tim',
      recurrence: null,
      next_due: null,
    });
  });

  it('refuses an empty amount without calling the server', async () => {
    const s = open();
    await screen.findByText('Shell');
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save expense' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/above zero/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('deletes a row and answers a due reminder', async () => {
    const s = open(
      [expense()],
      [expense({ id: 9, recurrence: 'monthly', next_due: '2023-11-14', merchant: 'Phone co' })],
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add it' }));
    await waitFor(() =>
      expect(s.calls.some((c) => c.path === '/expenses/9/occurrences')).toBe(true),
    );
    expect(s.calls.find((c) => c.path === '/expenses/9/occurrences')?.body).toEqual({
      spent_on: '2023-11-14',
    });
    fireEvent.click(screen.getByRole('button', { name: /Remind me in a week/ }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/expenses/9/snooze')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /Delete Shell/ }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('is absent when the module is off: no navigation entry, and the URL leads elsewhere', async () => {
    const s = open([expense()], [], false);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Expenses' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/expenses'))).toBe(false);
  });

  it('builds a recurring body only when it repeats', () => {
    const base = {
      spent_on: '2023-01-01',
      category: 'fuel',
      amount: '1',
      merchant: '',
      deductible: true,
      business_pct: 100,
      vehicle_id: '',
      shift_id: '',
      notes: '',
      recurrence: '',
      next_due: '2023-02-01',
    };
    expect(bodyOf(base)).toMatchObject({ recurrence: null, next_due: null });
    expect(bodyOf({ ...base, recurrence: 'monthly' })).toMatchObject({
      recurrence: 'monthly',
      next_due: '2023-02-01',
    });
  });
});
