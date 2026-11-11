// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, settingsFixture, signedIn, DASHBOARD } from './support/kit';
import type { Schemas } from '../src/api/client';

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
function open(
  world: {
    vehicles?: object[];
    backups?: object[];
    devices?: object[];
    platforms?: object[];
    shifts?: object[];
    status?: object;
    kept?: Schemas['SetupStep'][];
  },
  modules: object = {},
) {
  let kept = world.kept ?? [];
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules, setup_done: kept })),
      'PATCH /settings': (req) => {
        const add = (req.body as { setup_done?: Schemas['SetupStep'][] }).setup_done ?? [];
        kept = [...kept, ...add.filter((x) => !kept.includes(x))];
        return { body: settingsFixture({ modules, setup_done: kept }) };
      },
      'GET /summary': () => ({ body: summary }),
      'GET /vehicles': () => ({ body: world.vehicles ?? [] }),
      'GET /backups': () => ({ body: world.backups ?? [] }),
      'GET /devices': () => ({ body: world.devices ?? [] }),
      'GET /platforms': () => ({ body: world.platforms ?? [] }),
      'GET /shifts': () => ({ body: { items: world.shifts ?? [], next_cursor: null } }),
      'GET /system/status': () => ({ body: world.status ?? systemStatus() }),
    },
    '/dashboard',
  );
}

const HOUR = 3_600_000;
const NOW = Date.parse('2027-01-15T15:00:00Z');
const systemStatus = (over: object = {}) => ({
  app_version: '0.2.0',
  schema_version: 40,
  sqlite_version: '3.52.0',
  db_bytes: 4_000_000,
  wal_bytes: 0,
  disk_free_bytes: 50_000_000_000,
  disk_state: 'ok',
  last_backup: {
    id: 1,
    created_at: NOW - 12 * HOUR,
    size_bytes: 1,
    sha256: 'ab',
    integrity_ok: true,
    trigger: 'nightly',
  },
  last_backup_failure: null,
  offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: false },
  paired_device_count: 1,
  mode: 'normal',
  ...over,
});

const shift = (id: number, review: boolean) => ({
  id,
  local_date: '2027-01-14',
  started_at: 1,
  ended_at: 2,
  status: 'ended',
  segmenter: 'whole_shift',
  total_m: 1000,
  active_m: 1000,
  deadhead_m: 0,
  deduction_cents: null,
  notes: null,
  flags: review ? [{ code: 'gap_counted', severity: 'review' }] : [{ code: 'x', severity: 'info' }],
});

describe('dashboard checklist and notices (18 section 13)', () => {
  it('notices: shifts to review in the last 30 days and an overdue backup, each with a link', async () => {
    const s = open({
      shifts: [shift(1, true), shift(2, false), shift(3, true)],
      // The newest verified backup is 40 hours old: more than a day and a half.
      status: systemStatus({
        last_backup: { ...systemStatus().last_backup, created_at: NOW - 40 * HOUR },
      }),
    });
    const review = (await screen.findByText(/2 shifts from the last 30 days have checks/)).closest(
      '[role="note"]',
    )!;
    expect(
      within(review as HTMLElement)
        .getByRole('link', { name: 'Review shifts' })
        .getAttribute('href'),
    ).toBe('/shifts');
    const backup = (await screen.findByText(/No successful backup/)).closest('[role="note"]')!;
    expect(
      within(backup as HTMLElement)
        .getByRole('link', { name: 'Open Backups' })
        .getAttribute('href'),
    ).toBe('/backups');
    expect(
      s.calls.find((c) => c.path === '/shifts' && c.query.includes('from=2026-12-17'))!.query,
    ).toContain('to=2027-01-15');
    cleanup();
    // A backup from 12 hours ago and nothing to review: no notice.
    open({ shifts: [shift(2, false)] });
    await screen.findByRole('group', { name: 'Finish setting up' });
    expect(screen.queryByText(/checks to review|No successful backup|backup failed/)).toBeNull();
  });

  it('a failed last backup shows as a notice with its time and a link to Backups', async () => {
    open({
      status: systemStatus({
        // A good backup 12 hours ago, then a run that failed (22:00 in Toronto).
        last_backup_failure: {
          at: Date.parse('2027-01-15T03:00:00Z'),
          message: 'Not enough free disk space for a backup.',
        },
      }),
    });
    const note = (
      await screen.findByText(
        /The last backup failed on Jan 14, 2027, 22:00\. Older backups are kept\./,
      )
    ).closest('[role="note"]') as HTMLElement;
    expect(within(note).getByRole('link', { name: 'Open Backups' }).getAttribute('href')).toBe(
      '/backups',
    );
    // One notice for the backup, not the overdue one as well.
    expect(screen.queryByText(/No successful backup/)).toBeNull();
  });

  it('wide: setup sits in a side column after the hero and the shifts; narrow: setup first', async () => {
    open({});
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    const hero = await screen.findByRole('region', { name: 'Earned' });
    expect(card.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    try {
      open({});
      const side = (await screen.findByRole('group', { name: 'Finish setting up' })).parentElement!;
      expect(side.hasAttribute('data-side')).toBe(true);
      const recent = await screen.findByRole('region', { name: 'Recent shifts' });
      expect(recent.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      width.mockRestore();
    }
  });

  it('lists what is not done from server state as links, the next step marked, done folded away', async () => {
    open({ vehicles: [vehicle] });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(within(card).getByText('1 of 3 done')).toBeTruthy();
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    const links = within(card)
      .getAllByRole('link')
      .map((l) => [l.textContent, l.getAttribute('href')]);
    expect(links).toEqual([
      ['Pair your phoneNextThe phone records your shifts.', '/devices'],
      ['Run a backupA copy of your data you can restore.', '/backups'],
    ]);
    expect(within(card).queryByText(/Add your vehicle/)).toBeNull();
    expect(card.textContent).not.toMatch(/other apps/);
    const fold = within(card).getByRole('button', { name: '1 done' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(card.textContent).toMatch(/Add your vehicle \(done\)/);
  });

  it('keeps a step done once seen done, so unpairing the phone later does not reopen it (W8)', async () => {
    const s = open({ vehicles: [vehicle] });
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ setup_done: ['vehicle'] }),
    );
    cleanup();
    // The phone was paired (and kept) earlier, then unpaired: it still counts as done.
    open({ vehicles: [vehicle], kept: ['vehicle', 'phone'] });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(within(card).getByText('2 of 3 done')).toBeTruthy();
    expect(within(card).queryByRole('link', { name: /Pair your phone/ })).toBeNull();
  });

  it('skips an optional step for good; required steps have no Skip', async () => {
    const s = open({ vehicles: [vehicle] });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(within(card).queryByRole('button', { name: /Skip: Pair your phone/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Skip: Run a backup' }));
    await waitFor(() =>
      expect(within(card).queryByRole('link', { name: /Run a backup/ })).toBeNull(),
    );
    expect(s.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toContainEqual({
      setup_done: ['backup'],
    });
    expect(within(card).getByText('2 of 3 done')).toBeTruthy();
  });

  it('Hide for now is kept in this browser and can be undone', async () => {
    localStorage.removeItem('mw-setup-hidden');
    open({ vehicles: [vehicle] });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    fireEvent.click(within(card).getByRole('button', { name: 'Hide for now' }));
    expect(screen.queryByRole('group', { name: 'Finish setting up' })).toBeNull();
    expect(screen.getByText(/Setup steps hidden \(2 left\)/)).toBeTruthy();
    cleanup();
    open({ vehicles: [vehicle] });
    fireEvent.click(await screen.findByRole('button', { name: 'Show them' }));
    expect(await screen.findByRole('group', { name: 'Finish setting up' })).toBeTruthy();
    expect(localStorage.getItem('mw-setup-hidden')).toBeNull();
    cleanup();
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      open({ vehicles: [vehicle] });
      expect(await screen.findByRole('group', { name: 'Finish setting up' })).toBeTruthy();
    } finally {
      blocked.mockRestore();
    }
  });

  it('a new owner is asked for the vehicle first, with no Skip: a shift needs one', async () => {
    open({});
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(within(card).getByText('0 of 3 done')).toBeTruthy();
    const first = within(card).getAllByRole('link')[0]!;
    expect(first.textContent).toBe(
      'Add your vehicleNextA shift needs one, and your logbook and deduction use it.',
    );
    expect(first.getAttribute('href')).toBe('/vehicles');
    expect(within(card).queryByRole('button', { name: /Skip: Add your vehicle/ })).toBeNull();
    expect(within(card).queryByRole('link', { name: 'Continue setup' })).toBeNull();
  });

  it('the province prompt (Q4)', async () => {
    open({ vehicles: [vehicle] });
    expect(await screen.findByText(/Set your province to include its own rules/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set your province' }).getAttribute('href')).toBe(
      '/settings/general',
    );
    cleanup();
    renderApp({ ...signedIn(settingsFixture({ region: 'ON' })) }, '/dashboard');
    await screen.findByRole('heading', { name: DASHBOARD });
    expect(screen.queryByText(/Set your province/)).toBeNull();
  });

  it('leaves out the items of modules that are off, and disappears when everything left is done', async () => {
    const done = open(
      { vehicles: [vehicle], backups: [{ id: 1 }] },
      { platforms: false, devices: false },
    );
    await waitFor(() => expect(done.calls.some((c) => c.path === '/backups')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Finish setting up' })).toBeNull();
    cleanup();
    open({ vehicles: [vehicle] }, { platforms: false, devices: false });
    const card = await screen.findByRole('group', { name: 'Finish setting up' });
    expect(card.textContent).not.toMatch(/other apps|Pair your phone/);
  });

  it('the Today and Week tabs ask /summary for one day and for the week from the week start', async () => {
    const s = open({});
    await screen.findByRole('region', { name: 'Earned' });
    expect(screen.getByText('Jan 11 – 15, 2027')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Today' }));
    await screen.findByText('Friday, Jan 15');
    const asked = s.calls.filter((c) => c.path === '/summary').map((c) => c.query);
    expect(asked).toContain('?from=2027-01-11&to=2027-01-15');
    expect(asked).toContain('?from=2027-01-15&to=2027-01-15');
  });
});
