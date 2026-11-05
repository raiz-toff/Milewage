// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Modules } from '../src/api/client';
import { screens, visibleScreens } from '../src/screens';
import { ALL_ON, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

/** Every optional module off. What remains is the core. */
const ALL_OFF: Modules = {
  ...ALL_ON,
  sync: false,
  devices: false,
  tracking: false,
  replay: false,
  live: false,
  stops: false,
  diagnostics: false,
  capture: false,
  platforms: false,
  earnings: false,
  expenses: false,
  exporters: [],
};

const shift = {
  id: 1,
  client_id: '00000000-0000-4000-8000-000000000001',
  vehicle_id: 1,
  status: 'ended',
  segmenter: 'stops',
  started_at: 1_700_000_000_000,
  ended_at: 1_700_003_600_000,
  local_date: '2023-11-14',
  total_m: 5000,
  active_m: 3000,
  deadhead_m: 2000,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
};
const routeBody = {
  source: 'raw',
  t: [1, 2],
  lat_e7: [450_000_000, 450_000_100],
  lon_e7: [-750_000_000, -750_000_100],
};

const open = (modules: Partial<Modules>, url: string) =>
  renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /shifts': () => ({ body: { items: [shift], next_cursor: null } }),
      'GET /shifts/1': () => ({ body: shift }),
      'GET /shifts/1/route': () => ({ body: routeBody }),
      'GET /devices': () => ({ body: [] }),
    },
    url,
  );

const navNames = async () => {
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
};

describe('module flags hide screens (05 section 5, 17 section 8 item 5)', () => {
  it('with every optional module off only the core screens remain', async () => {
    open(ALL_OFF, '/shifts');
    expect(await navNames()).toEqual([
      'Dashboard',
      'Shifts',
      'Vehicles',
      'Odometer',
      'Backups',
      'Settings',
    ]);
  });

  it('with every module on, the navigation lists each screen', async () => {
    open(ALL_ON, '/shifts');
    expect(await navNames()).toEqual([
      'Dashboard',
      'Live map',
      'Shifts',
      'Expenses',
      'Vehicles',
      'Odometer',
      'Exports',
      'Devices',
      'Backups',
      'Settings',
    ]);
  });

  it('the screen registry: a rule exists only for module-owned screens, core has none', () => {
    const core = screens.filter((s) => !s.visible).map((s) => s.label);
    expect(core).toEqual(['Dashboard', 'Shifts', 'Vehicles', 'Odometer', 'Backups', 'Settings']);
    // Every screen with a rule disappears when all optional modules are off.
    for (const s of screens.filter((x) => x.visible)) {
      expect(s.visible!(ALL_ON), `${s.label} visible with module on`).toBe(true);
      expect(visibleScreens(ALL_OFF).includes(s), `${s.label} hidden`).toBe(false);
    }
  });

  it('devices off: not in the navigation, and its URL leads to the first visible screen', async () => {
    open({ devices: false }, '/devices');
    expect(await navNames()).not.toContain('Devices');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).toBeNull();
  });

  it('replay off: shift detail has no route section and asks for no route', async () => {
    const { calls } = open({ replay: false }, '/shifts/1');
    await screen.findByRole('heading', { name: /2023-11-14/ });
    expect(screen.queryByRole('region', { name: 'Route' })).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/route'))).toBe(false);
  });

  it('stops off: no split in the list or the detail, and no estimate marker anywhere', async () => {
    open({ stops: false }, '/shifts');
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: /Active/ })).toBeNull();
    expect(screen.queryByText(/estimated/)).toBeNull();
    cleanup();
    open({ stops: false }, '/shifts/1');
    await screen.findByRole('heading', { name: /2023-11-14/ });
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText('Deadhead')).toBeNull();
    expect(screen.queryByText(/estimated/)).toBeNull();
  });

  it('stops on: the split and its estimate marker are there', async () => {
    open({ stops: true }, '/shifts/1');
    await screen.findByRole('heading', { name: /2023-11-14/ });
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/estimated from detected stops/)).toBeTruthy();
  });

  it('diagnostics off: the diagnostics level setting is gone, the rest of settings stays', async () => {
    open({ diagnostics: false }, '/settings');
    await screen.findByLabelText('Currency');
    expect(screen.queryByLabelText('Diagnostics level')).toBeNull();
    expect(screen.getByLabelText(/Detect stops/)).toBeTruthy();
  });

  it('diagnostics on: the level setting is there', async () => {
    open({ diagnostics: true }, '/settings');
    expect(await screen.findByLabelText('Diagnostics level')).toBeTruthy();
  });
});
