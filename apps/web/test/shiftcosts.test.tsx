// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shift, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const expense = (id: number, category: string, amount_cents: number, merchant = '') => ({
  id,
  spent_on: '2023-11-14',
  category,
  amount_cents,
  merchant,
  deductible: true,
  business_pct: 100,
  tax_credit_cents: 0,
  vehicle_id: 1,
  shift_id: 1,
  notes: null,
  recurrence: null,
  next_due: null,
  snoozed_until: null,
  template_id: null,
  deductible_cents: amount_cents,
  double_counts: false,
  has_receipt: false,
  created_at: 1,
  updated_at: 1,
});

function open(settings = settingsFixture()) {
  let items = [expense(7, 'parking', 650, 'Green P'), expense(8, 'fuel', 4000)];
  const queries: string[] = [];
  const s = renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: shift() }),
      'GET /shifts/1/trips': () => ({ body: [trip(1)] }),
      'GET /shifts/1/stops': () => ({ body: [] }),
      'GET /odometer': () => ({ body: [] }),
      'GET /expenses': ({ url }) => {
        queries.push(url.search);
        return { body: { items, next_cursor: null } };
      },
      'POST /expenses': ({ body }) => {
        const e = { ...expense(9, 'tolls', 0), ...(body as object) };
        items = [e, ...items];
        return { status: 201, body: e };
      },
      'DELETE /expenses/7': () => {
        items = items.filter((x) => x.id !== 7);
        return { status: 204 };
      },
    },
    '/shifts/1',
  );
  return { ...s, queries };
}

describe("a shift's parking and tolls", () => {
  it('lists them with a total, adds a toll as an expense of the shift, and removes one', async () => {
    const { calls, queries } = open();
    const more = await screen.findByRole('region', { name: 'More' });
    // Folded under its name with the shift's total; fuel is an expense of the shift, not a cost here.
    await within(more).findByText('$6.50 on this shift');
    expect(queries[0]).toBe('?shift_id=1&limit=200');
    const form = within(more).getByRole('form', { name: 'Add parking or a toll' });
    fireEvent.click(within(form).getByRole('button', { name: 'Toll' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add toll' }));
    expect((await within(more).findByRole('alert')).textContent).toMatch(/Enter the amount/);
    fireEvent.change(within(form).getByLabelText('Amount (CAD)'), { target: { value: '3.75' } });
    fireEvent.change(within(form).getByLabelText('Where (optional)'), {
      target: { value: '407 ETR' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add toll' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        spent_on: shift().local_date,
        category: 'tolls',
        amount_cents: 375,
        merchant: '407 ETR',
        vehicle_id: shift().vehicle_id,
        shift_id: 1,
      }),
    );
    await within(more).findByText('$10.25 on this shift');
    fireEvent.click(within(more).getByRole('button', { name: 'Remove parking $6.50' }));
    await within(more).findByText('$3.75 on this shift');
  });

  it('is not offered when the expenses module is off', async () => {
    const { queries } = open(settingsFixture({ modules: { expenses: false } }));
    const more = await screen.findByRole('region', { name: 'More' });
    expect(within(more).queryByText('Parking and tolls')).toBeNull();
    expect(queries).toEqual([]);
  });
});
