// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { uuid } from '../src/pages/AddTrip';
import { shift, trip } from './support/fixtures';
import { menu, renderApp, settingsFixture, signedIn } from './support/kit';

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

describe('edit and delete a hand-made trip (TODO W2i)', () => {
  const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const manual = trip(9, {
    trip_key: UUID,
    source: 'manual',
    kind: 'active',
    started_at: T0 + 600_000,
    ended_at: T0 + 1_200_000,
    distance_m: 4250,
    purpose: 'Lunch run',
    edited_at: T0 + 2_000_000,
  });
  function openWith(theShift: object = shift()) {
    let trips: object[] = [trip(1), manual];
    return renderApp(
      {
        ...signedIn(settingsFixture()),
        'GET /shifts/1': () => ({ body: theShift }),
        'GET /shifts/1/trips': () => ({ body: trips }),
        'GET /shifts/1/stops': () => ({ body: [] }),
        'GET /odometer': () => ({ body: [] }),
        'PUT /shifts/1/trips/*': ({ body }) => {
          trips = [trip(1), { ...manual, ...(body as object) }];
          return { body: { trip: trips[1], shift: theShift } };
        },
        'DELETE /trips/9': () => {
          trips = [trip(1)];
          return { status: 204 };
        },
      },
      '/shifts/1',
    );
  }

  it("Edit opens the form filled in; a change is sent on the trip's own id, newer than its last edit", async () => {
    const s = openWith();
    await screen.findByText(/Lunch run/);
    // Only the hand-made trip has the menu; a recorded trip does not.
    expect(screen.getAllByRole('button', { name: /^Actions for trip at/ })).toHaveLength(1);
    menu(/trip at/, 'Edit');
    const form = screen.getByRole('form', { name: 'Edit trip' });
    expect((within(form).getByLabelText('Distance (km)') as HTMLInputElement).value).toBe('4.25');
    expect((within(form).getByLabelText('Purpose') as HTMLInputElement).value).toBe('Lunch run');
    fireEvent.change(within(form).getByLabelText('Distance (km)'), { target: { value: '5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Trip · 5\.0 km/)).toBeTruthy();
    const put = s.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/shifts/1/trips/${UUID}`);
    const body = put.body as Record<string, number | string>;
    // Unchanged times keep the stored instants to the millisecond.
    expect(body).toMatchObject({
      kind: 'active',
      started_at: T0 + 600_000,
      ended_at: T0 + 1_200_000,
      distance_m: 5000,
      purpose: 'Lunch run',
    });
    expect(body.edited_at as number).toBeGreaterThan(T0 + 2_000_000);
    expect(screen.queryByRole('form', { name: 'Edit trip' })).toBeNull();
  });

  it('Delete asks first, then deletes; Cancel leaves the trip', async () => {
    const s = openWith();
    await screen.findByText(/Lunch run/);
    menu(/trip at/, 'Delete');
    let dialog = await screen.findByRole('dialog', { name: 'Delete this trip?' });
    expect(dialog.textContent).toMatch(/4\.3 km/);
    expect(dialog.textContent).toMatch(/cannot be undone/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);
    menu(/trip at/, 'Delete');
    dialog = await screen.findByRole('dialog', { name: 'Delete this trip?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete trip' }));
    await waitFor(() => expect(screen.queryByText(/Lunch run/)).toBeNull());
    expect(s.calls.find((c) => c.method === 'DELETE')?.path).toBe('/trips/9');
  });

  it('a finalized shift offers neither', async () => {
    openWith(shift({ status: 'finalized' }));
    await screen.findByText(/Lunch run/);
    expect(screen.queryByRole('button', { name: /^Actions for trip at/ })).toBeNull();
  });
});
