// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shift } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const T0 = 1_700_000_000_000;
/** The owner's case (2026-11-07): ended after 40 s, nothing recorded, the phone's result missing. */
const nothing = shift({
  ended_at: T0 + 40_000,
  total_m: 0,
  active_m: 0,
  deadhead_m: 0,
  recon_status: 'phone_missing',
  flags: [
    { code: 'low_fix_density', severity: 'info' },
    { code: 'no_stops_detected', severity: 'info' },
  ],
});

function open(theShift: object, settings = settingsFixture(), trips: object[] = []) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: theShift }),
      'GET /shifts/1/trips': () => ({ body: trips }),
      'GET /shifts/1/stops': () => ({ body: [] }),
    },
    '/shifts/1',
  );
}

const items = (el: HTMLElement) =>
  within(el)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('shift detail with little or nothing recorded', () => {
  it('explains a shift with no route in one card: what happened, why, what to do', async () => {
    open(nothing);
    const card = await screen.findByRole('region', { name: 'What happened' });
    expect(within(card).getByText('No route for this shift')).toBeTruthy();
    expect(within(card).getByText(/sent no location points/)).toBeTruthy();
    expect(
      within(card).getByText(/under 3 minutes, so it may have been started by mistake/),
    ).toBeTruthy();
    expect(items(within(card).getByRole('list', { name: 'Checks' }))).toEqual([
      'Few positions were recorded for the length of the shift.',
      "The phone's result never arrived.",
    ]);
    const todo = items(within(card).getByRole('list', { name: 'What you can do' }));
    expect(todo).toHaveLength(2);
    expect(todo[0]).toMatch(/open Permissions: location “Allow all the time”/);
    expect(todo[1]).toMatch(/Open MileWage on the phone while it has a connection/);
    // No empty map box, no second checks card, no split of zero.
    expect(screen.queryByRole('region', { name: 'Route' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Checks' })).toBeNull();
    expect(screen.queryByText(/estimated from detected stops/)).toBeNull();
    // The timeline is just start and end.
    const timeline = await screen.findByRole('region', { name: 'Timeline' });
    expect(within(timeline).getByText('Start and end only')).toBeTruthy();
    expect(items(within(timeline).getByRole('list', { name: 'Timeline' }))).toEqual([
      '17:13Shift started',
      '17:14Shift ended',
    ]);
    expect(screen.queryByText('No trips were recorded.')).toBeNull();
  });

  it('with the route module off, says no trips were recorded and asks for no route', async () => {
    const s = open(nothing, settingsFixture({ modules: { replay: false } }));
    const card = await screen.findByRole('region', { name: 'What happened' });
    expect(within(card).getByText('No trips for this shift')).toBeTruthy();
    expect(screen.queryByText(/route map is off/)).toBeNull();
    expect(s.calls.some((c) => c.path.endsWith('/route'))).toBe(false);
  });

  it('a running shift says it is in progress and when the route will appear', async () => {
    const s = open(shift({ status: 'active', ended_at: null, total_m: null, calculated_at: null }));
    const card = await screen.findByRole('region', { name: 'In progress' });
    expect(within(card).getByText(/sends its positions in batches/)).toBeTruthy();
    expect(within(card).getByText(/appear here then/)).toBeTruthy();
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    expect(items(timeline)).toEqual(['17:13Shift started', 'nowShift in progress']);
    expect(screen.queryByRole('region', { name: 'Checks' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'What happened' })).toBeNull();
    await waitFor(() => expect(s.calls.some((c) => c.path.endsWith('/trips'))).toBe(true));
    expect(s.calls.some((c) => c.path.endsWith('/route'))).toBe(false);
  });
});
