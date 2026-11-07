// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { toCents } from '../src/pages/ShiftEarnings';
import { pick, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const shift = (status = 'ended') => ({
  id: 1,
  client_id: '00000000-0000-4000-8000-000000000001',
  vehicle_id: 1,
  status,
  segmenter: 'whole_shift',
  started_at: 1_700_000_000_000,
  ended_at: status === 'active' ? null : 1_700_003_600_000,
  local_date: '2023-11-14',
  total_m: 5000,
  active_m: null,
  deadhead_m: null,
  personal_m: 5000,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
});
const empty = { entries: [], labels: [], effective: [] };
const typed = {
  entries: [
    {
      platform: 'doordash',
      gross_cents: 3000,
      tips_cents: 500,
      bonus_cents: 0,
      fees_cents: 0,
      adjustments_cents: 0,
      total_cents: 3500,
      tax_withheld_cents: 0,
      cash_collected_cents: 0,
      balance_cents: 3500,
      orders: 7,
      online_min: null,
      notes: null,
      source: 'manual',
      edited_at: 1,
      ledger: [
        { id: 1, type: 'fare', amount_cents: 3000, note: null, created_at: 1 },
        { id: 2, type: 'tip', amount_cents: 500, note: null, created_at: 1 },
      ],
    },
  ],
  labels: [],
  effective: [
    {
      platform: 'doordash',
      gross_cents: 3000,
      tips_cents: 500,
      bonus_cents: 0,
      fees_cents: 0,
      adjustments_cents: 0,
      tax_withheld_cents: 0,
      total_cents: 3500,
      orders: 7,
      source: 'entered',
    },
  ],
};

/** The typed row after a cash trip: commission 20.00 taken, 100.00 collected in cash. */
const cash = (() => {
  const row = typed.entries[0]!;
  return {
    ...typed,
    entries: [
      {
        ...row,
        fees_cents: -2000,
        total_cents: 1500,
        cash_collected_cents: -10_000,
        balance_cents: -8500,
        ledger: [
          ...row.ledger,
          { id: 3, type: 'cash_collected', amount_cents: -10_000, note: 'trip 4', created_at: 2 },
          { id: 4, type: 'commission', amount_cents: -2000, note: null, created_at: 2 },
        ],
      },
    ],
  };
})();

function open(over: { earnings?: boolean; status?: string; start?: typeof typed } = {}) {
  let current: object = over.start ?? empty;
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { earnings: over.earnings ?? true, stops: false } })),
      'GET /shifts/1': () => ({ body: shift(over.status) }),
      'GET /shifts/1/route': () => ({ body: { source: 'raw', t: [], lat_e7: [], lon_e7: [] } }),
      'GET /odometer': () => ({ body: [] }),
      'GET /shifts/1/trips': () => ({ body: [] }),
      'GET /shifts/1/earnings': () => ({ body: current }),
      'PUT /shifts/1/earnings/doordash': () => ({ body: (current = typed) }),
      'DELETE /shifts/1/earnings/doordash': () => ({ body: (current = empty) }),
      'POST /shifts/1/earnings/doordash/entries': () => ({ body: (current = cash) }),
      'DELETE /shifts/1/earnings/doordash/entries/4': () => ({ body: (current = typed) }),
      'GET /platforms': () => ({
        body: [
          {
            slug: 'doordash',
            label: 'DoorDash',
            custom: false,
            color: null,
            emoji: null,
            active: true,
            sort: 0,
            hourly_target_cents: null,
          },
        ],
      }),
    },
    '/shifts/1',
  );
}

describe('shift earnings block (module earnings)', () => {
  it('types a total in dollars, sends whole cents, shows it, and removes it', async () => {
    const s = open();
    expect(await screen.findByText(/No earnings entered or labelled/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Base pay'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Gratuities'), { target: { value: '5.00' } });
    fireEvent.change(screen.getByLabelText('Orders'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
    expect(await screen.findByText(/DoorDash: \$35\.00, 7 orders/)).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      gross_cents: 3000,
      tips_cents: 500,
      bonus_cents: 0,
      orders: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: /Remove entered total for DoorDash/ }));
    expect(await screen.findByText(/No earnings entered or labelled/)).toBeTruthy();
  });

  it('refuses a negative amount without calling the server', async () => {
    const s = open();
    await screen.findByText(/No earnings entered/);
    fireEvent.change(screen.getByLabelText('Base pay'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/zero or more/);
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('is absent when the module is off or the shift is still active', async () => {
    const off = open({ earnings: false });
    await screen.findByRole('heading', { name: /2023-11-14/ });
    expect(screen.queryByRole('region', { name: 'Earnings' })).toBeNull();
    expect(off.calls.some((c) => c.path.endsWith('/earnings'))).toBe(false);
    cleanup();
    open({ status: 'active' });
    await screen.findByRole('heading', { name: /2023-11-14/ });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Earnings' })).toBeNull());
  });

  it('adds a line with the sign of its kind, shows what is owed, and removes a line', async () => {
    const s = open({ start: typed });
    expect(await screen.findByText(/DoorDash: \$35\.00/)).toBeTruthy();
    expect(screen.queryByText(/Balance with the app|You owe the app/)).toBeNull(); // a plain row
    pick('Kind', 'commission');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(await screen.findByText(/You owe the app \$85\.00/)).toBeTruthy();
    expect(screen.getByText(/Cash collected -\$100\.00 \(trip 4\)/)).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'commission',
      amount_cents: -2000,
    });
    pick('Kind', 'adjustment');
    pick('Direction', 'no');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1.50' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'late fee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({
        type: 'adjustment',
        amount_cents: -150,
        note: 'late fee',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Commission -$20.00' }));
    await waitFor(() => expect(screen.queryByText(/You owe the app/)).toBeNull());
    expect(s.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/entries/4'))).toBe(true);
  });

  it('refuses a line without an amount above zero', async () => {
    const s = open();
    await screen.findByText(/No earnings entered/);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/above zero/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('converts typed dollars to cents', () => {
    expect([toCents(''), toCents('12.5'), toCents('12,50'), toCents('0.07')]).toEqual([
      0, 1250, 1250, 7,
    ]);
    expect(Number.isNaN(toCents('abc'))).toBe(true);
  });
});
