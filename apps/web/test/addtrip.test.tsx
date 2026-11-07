// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { uuid } from '../src/pages/AddTrip';
import { shift, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const nothing = shift({ ended_at: T0 + 40_000, total_m: 0, active_m: 0, deadhead_m: 0 });

function open(theShift: object = nothing) {
  let trips: object[] = [];
  return renderApp(
    {
      ...signedIn(settingsFixture()),
      'GET /shifts/1': () => ({ body: theShift }),
      'GET /shifts/1/trips': () => ({ body: trips }),
      'GET /shifts/1/stops': () => ({ body: [] }),
      'GET /odometer': () => ({ body: [] }),
      'PUT /shifts/1/trips/*': ({ body }) => {
        const b = body as { distance_m: number; purpose: string };
        trips = [trip(9, { source: 'manual', kind: 'active', ...b, started_at: T0 })];
        return {
          body: { trip: trips[0], shift: { ...nothing, total_m: b.distance_m, calculated_at: 2 } },
        };
      },
    },
    '/shifts/1',
  );
}

describe('add a trip by hand', () => {
  it('from the no-route card: sends the distance for the shift times, then lists the trip', async () => {
    const s = open();
    const card = await screen.findByRole('region', { name: 'What happened' });
    fireEvent.click(within(card).getByRole('button', { name: 'Add a trip' }));
    const form = screen.getByRole('form', { name: 'Add a trip' });
    fireEvent.change(within(form).getByLabelText('Distance (km)'), { target: { value: '12.5' } });
    fireEvent.change(within(form).getByLabelText('Purpose'), { target: { value: 'Deliveries' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add trip' }));
    expect(await screen.findByText(/Trip · 12\.5 km/)).toBeTruthy();
    const put = s.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toMatch(/^\/shifts\/1\/trips\/[0-9a-f-]{36}$/);
    expect(put.body).toMatchObject({
      kind: 'active',
      started_at: T0,
      ended_at: T0 + 40_000,
      distance_m: 12_500,
      purpose: 'Deliveries',
    });
    expect(screen.queryByRole('form', { name: 'Add a trip' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'What happened' })).toBeNull();
    // With a trip, the timeline offers the next one.
    const timeline = screen.getByRole('region', { name: 'Timeline' });
    expect(within(timeline).getByRole('button', { name: 'Add a trip' })).toBeTruthy();
  });

  it('refuses a distance that is not a number, and can be cancelled', async () => {
    const s = open();
    const card = await screen.findByRole('region', { name: 'What happened' });
    // Offered once: in the card that explains the empty shift, not again in the timeline.
    expect(screen.getAllByRole('button', { name: 'Add a trip' })).toHaveLength(1);
    fireEvent.click(within(card).getByRole('button', { name: 'Add a trip' }));
    const form = screen.getByRole('form', { name: 'Add a trip' });
    fireEvent.change(within(form).getByLabelText('Distance (km)'), { target: { value: 'ten' } });
    fireEvent.change(within(form).getByLabelText('Purpose'), { target: { value: 'x' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add trip' }));
    expect((await within(form).findByRole('alert')).textContent).toMatch(/number of km/);
    expect(s.calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add a trip' })).toBeNull();
  });

  it('is not offered on a running or a reviewed shift', async () => {
    open(shift({ status: 'active', ended_at: null }));
    await screen.findByRole('region', { name: 'In progress' });
    expect(screen.queryByRole('button', { name: 'Add a trip' })).toBeNull();
    cleanup();
    open(shift({ status: 'finalized' }));
    await screen.findByRole('region', { name: 'Timeline' });
    expect(screen.queryByRole('button', { name: 'Add a trip' })).toBeNull();
  });

  it('makes version 4 UUIDs', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid()).not.toBe(uuid());
  });
});
