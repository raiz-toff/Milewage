// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hasStackedOrders, toCents } from '../src/pages/Stops';
import { shift, stop, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn, pick } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const label = (s: ReturnType<typeof stop>, over: object = {}) => ({
  stop_key: s.stop_key,
  shift_id: 1,
  role: 'dropoff' as const,
  platform: 'uber_eats',
  place: null,
  payout_cents: 1250,
  tip_cents: 300,
  notes: null,
  edited_at: 1,
  ...over,
});

const path = (s: ReturnType<typeof stop>) =>
  `/shifts/1/stop-labels/${encodeURIComponent(s.stop_key)}`;

function open(
  stops: ReturnType<typeof stop>[],
  extra: Record<string, Handler> = {},
  settings = settingsFixture(),
  theShift: object = shift(),
) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: theShift }),
      'GET /shifts/1/trips': () => ({ body: [trip(1)] }),
      'GET /shifts/1/stops': () => ({ body: stops }),
      ...extra,
    },
    '/shifts/1',
  );
}

const panel = async () => {
  const region = within(await screen.findByRole('region', { name: 'Stops' }));
  await region.findByRole('table', { name: 'Detected stops' });
  return region;
};
const field = (name: RegExp) => screen.getAllByLabelText(name)[0] as HTMLInputElement;

describe('stops table', () => {
  it('lists detected stops with the estimate marked and the label controls', async () => {
    const a = stop(1);
    const b = stop(2, { est_role: 'dropoff', role: 'dropoff', confidence: 'low' });
    open([a, b]);
    const p = await panel();
    const table = await p.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Estimate*' })).toBeTruthy();
    expect(within(table).getAllByRole('row').length).toBe(3);
    expect(within(table).getByText('low')).toBeTruthy();
    expect(within(table).getAllByText('3m 00s').length).toBe(2);
    expect(p.getByText(/The engine's estimate/)).toBeTruthy();
    // Nothing is labelled, so nothing can be saved or cleared.
    expect(
      (within(table).getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(table).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('saves a label, sends cents, and shows the recomputed split and trips', async () => {
    const a = stop(1);
    const recomputed = shift({ active_m: 4000, deadhead_m: 1000, calculated_at: 2 });
    const { calls } = open([a], {
      [`PUT ${path(a)}`]: () => ({
        body: { stop: { ...a, role: 'dropoff', label: label(a) }, shift: recomputed },
      }),
    });
    await panel();
    pick(field(/^Label at/), 'dropoff');
    fireEvent.change(field(/^Platform at/), { target: { value: 'uber_eats' } });
    fireEvent.change(field(/^Payout/), { target: { value: '12.50' } });
    fireEvent.change(field(/^Tip/), { target: { value: '3' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await screen.findByRole('button', { name: 'Clear' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({
      role: 'dropoff',
      platform: 'uber_eats',
      payout_cents: 1250,
      tip_cents: 300,
      place: null,
    });
    expect(typeof (put.body as { edited_at: number }).edited_at).toBe('number');
    // The detail above the table shows the recomputed estimate, and trips were read again.
    expect(screen.getByText(/^4\.0 km active/).textContent).toBe('4.0 km active*');
    expect(screen.getByText(/^1\.0 km deadhead/).textContent).toBe('1.0 km deadhead*');
    await waitFor(() => expect(calls.filter((c) => c.path === '/shifts/1/trips').length).toBe(2));
  });

  it('clears a label and the row returns to unlabelled', async () => {
    const a = stop(1, { role: 'dropoff', label: label(stop(1)) });
    const cleared = stop(1);
    const { calls } = open([a], {
      [`DELETE ${path(a)}`]: () => ({
        body: { stop: cleared, shift: shift({ calculated_at: 3 }) },
      }),
    });
    await panel();
    expect((field(/^Platform at/) as HTMLInputElement).value).toBe('uber_eats');
    expect((field(/^Payout/) as HTMLInputElement).value).toBe('12.50');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect((field(/^Platform at/) as HTMLInputElement).value).toBe('');
  });

  it('refuses an amount that is not money without calling the server', async () => {
    const a = stop(1);
    const { calls } = open([a]);
    await panel();
    pick(field(/^Label at/), 'pickup');
    fireEvent.change(field(/^Payout/), { target: { value: 'twelve' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByText('Enter an amount such as 12.50.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it("shows the server's refusal in the row", async () => {
    const a = stop(1);
    open([a], {
      [`PUT ${path(a)}`]: () => ({
        status: 422,
        body: {
          code: 'validation_failed',
          errors: [{ path: 'platform', message: 'bad platform' }],
        },
      }),
    });
    await panel();
    pick(field(/^Label at/), 'pickup');
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByText('platform: bad platform')).toBeTruthy();
  });
});

describe('stops warnings (05 section 3.1a)', () => {
  it('warns about stacked orders: a pickup after a pickup', async () => {
    open([stop(1), stop(2), stop(3, { role: 'dropoff', est_role: 'dropoff' })]);
    expect(await screen.findByText(/Stacked orders\?/)).toBeTruthy();
  });

  it('does not warn for alternating pickups and drop-offs', async () => {
    open([stop(1), stop(2, { role: 'dropoff', est_role: 'dropoff' }), stop(3)]);
    await panel();
    await screen.findByRole('table', { name: 'Detected stops' });
    expect(screen.queryByText(/Stacked orders\?/)).toBeNull();
  });

  it('warns that labelling may unlink edited trips', async () => {
    open(
      [stop(1)],
      {},
      settingsFixture(),
      shift({ flags: [{ code: 'manual_trip_present', severity: 'info' }] }),
    );
    expect(await screen.findByText(/Labelling a stop may unlink those edits/)).toBeTruthy();
  });

  it('lists a label that no longer matches a stop as not applied', async () => {
    open(
      [stop(1)],
      {},
      settingsFixture(),
      shift({ flags: [{ code: 'label_orphaned', severity: 'review', detail: 'k' }] }),
    );
    expect(await screen.findByText(/Label not applied/)).toBeTruthy();
  });

  it('says when no stop was detected', async () => {
    open([]);
    expect(await screen.findByText('No stops were detected.')).toBeTruthy();
  });

  it('pure helpers: stacked detection and money parsing', () => {
    const roles = (...r: string[]) => r.map((role) => stop(1, { role: role as 'pickup' }));
    expect(hasStackedOrders(roles('pickup', 'pickup'))).toBe(true);
    expect(hasStackedOrders(roles('pickup', 'other', 'dropoff', 'pickup'))).toBe(false);
    expect(toCents('')).toBe(0);
    expect(toCents('12.5')).toBe(1250);
    expect(toCents('0.07')).toBe(7);
    expect(toCents('1,50')).toBeNull();
    expect(toCents('-3')).toBeNull();
  });
});

describe('stops module off', () => {
  it('has no stops section and asks the server for no stops', async () => {
    const { calls } = open([stop(1)], {}, settingsFixture({ modules: { stops: false } }));
    await screen.findByRole('heading', { name: /Nov 14, 2023/ });
    await screen.findByRole('region', { name: 'Trips' });
    expect(screen.queryByRole('region', { name: 'Stops' })).toBeNull();
    expect(screen.queryByText(/Stacked orders/)).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/stops'))).toBe(false);
  });
});
