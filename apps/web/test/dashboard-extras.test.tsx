// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERIODS } from '../src/pages/Dashboard';
import { renderApp, settingsFixture, signedIn, pick } from './support/kit';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-15T15:00:00Z')); // a Friday
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const summary = {
  from: '2027-01-11',
  to: '2027-01-15',
  shift_count: 1,
  hours: 2,
  earnings_cents: null,
  tips_cents: null,
  active_m: 0,
  deadhead_m: 0,
  personal_m: 0,
  total_m: 0,
  deduction_cents: null,
  hourly_earnings_cents: null,
};
const vehicle = {
  id: 1,
  name: 'Civic',
  kind: 'car',
  make: null,
  model: null,
  year: null,
  plate: null,
  power: null,
  created_at: 1,
  archived_at: null,
};
const goal = (over: object = {}) => ({
  id: 1,
  label: 'Weekly pay',
  metric: 'earnings',
  period: 'weekly',
  target: 50_000,
  active: true,
  created_at: 1,
  progress: {
    value: 25_000,
    target: 50_000,
    ratio: 0.5,
    period_from: '2027-01-11',
    period_to: '2027-01-17',
    estimated: false,
    note: null,
  },
  ...over,
});

function open(
  world: {
    vehicles?: object[];
    goals?: object[];
    backups?: object[];
    devices?: object[];
    platforms?: object[];
  },
  modules: object = {},
) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /summary': () => ({ body: summary }),
      'GET /vehicles': () => ({ body: world.vehicles ?? [] }),
      'GET /goals': () => ({ body: world.goals ?? [] }),
      'GET /backups': () => ({ body: world.backups ?? [] }),
      'GET /devices': () => ({ body: world.devices ?? [] }),
      'GET /platforms': () => ({ body: world.platforms ?? [] }),
    },
    '/dashboard',
  );
}

describe('dashboard checklist and goal ring (18 section 13)', () => {
  it('lists what is not done from server state, for the modules that are on', async () => {
    open({ vehicles: [vehicle] });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(card.textContent).toMatch(/Add your other apps \(not done\)/);
    expect(card.textContent).toMatch(/Add your real vehicle \(done\)/);
    expect(card.textContent).toMatch(/Set a weekly goal \(not done\)/);
    expect(card.textContent).toMatch(/Pair your phone \(not done\)/);
    expect(card.textContent).toMatch(/Run a backup \(not done\)/);
  });

  it('leaves out the items of modules that are off, and disappears when everything left is done', async () => {
    const done = open(
      { vehicles: [vehicle], backups: [{ id: 1 }] },
      { platforms: false, goals: false, devices: false },
    );
    await waitFor(() => expect(done.calls.some((c) => c.path === '/backups')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Finish setting up' })).toBeNull();
    cleanup();
    open({ vehicles: [vehicle] }, { platforms: false, goals: false, devices: false });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(card.textContent).not.toMatch(/other apps|weekly goal|Pair your phone/);
  });

  it('shows the first active goal as the ring, and nothing without a goal or with the module off', async () => {
    open({ vehicles: [vehicle], goals: [goal({ id: 2, label: 'Paused', active: false }), goal()] });
    const ring = await screen.findByRole('group', { name: 'Goal' });
    expect(ring.textContent).toMatch(/Weekly pay.*\$250\.00 of \$500\.00/);
    cleanup();
    open({ goals: [] });
    await screen.findByRole('group', { name: 'Finish setting up' });
    expect(screen.queryByRole('group', { name: 'Goal' })).toBeNull();
    cleanup();
    const off = open({ goals: [goal()] }, { goals: false });
    await screen.findByRole('group', { name: 'Finish setting up' });
    expect(screen.queryByRole('group', { name: 'Goal' })).toBeNull();
    expect(off.calls.some((c) => c.path === '/goals')).toBe(false);
  });

  it('the Today and This week periods ask /summary for one day and for the week from the week start', async () => {
    const s = open({});
    await screen.findByLabelText(/Period/);
    pick(screen.getByLabelText(/Period/), 'week');
    await screen.findByText('2027-01-11 to 2027-01-15');
    pick(screen.getByLabelText(/Period/), 'today');
    await screen.findByText('2027-01-15 to 2027-01-15');
    expect(s.calls.filter((c) => c.path === '/summary').length).toBe(3);
    expect(
      PERIODS.find((p) => p.id === 'week')!.range(Date.parse('2027-01-17T12:00:00Z'), 'UTC', 0),
    ).toEqual({ from: '2027-01-17', to: '2027-01-17' });
  });
});
