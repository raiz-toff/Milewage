import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { ConnectionMonitor } from '../src/sync/connection';
import {
  buildStatus,
  markerFor,
  reminderFor,
  storageState,
  type StatusInput,
} from '../src/sync/status';
import { migrate } from '../src/db/appDb';
import { json, makeServices, mockServer, problem, SETTINGS } from './support/mock';
import { ID, server, setup } from './support/shiftKit';
import { openNodeAppDb } from './support/nodeSql';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const DAY = 86_400_000;
const base: StatusInput = {
  shifts: [],
  parkedItems: 0,
  oldestQueuedAt: null,
  wrongServer: false,
  restored: false,
  halted: null,
  offline: false,
  storage: 'normal',
};
const open = (state: 'local' | 'on_server' | 'needs_attention', at = 1000) =>
  ({
    sync_state: state,
    started_at: at,
    ended_at: at + 10,
    point_count: 100,
    status: 'ended',
  }) as const;

describe('markers, reminders, storage', () => {
  it('one marker per sync state, with a badge when the totals differ', () => {
    expect(markerFor({ sync_state: 'local', recon_status: 'pending' }).label).toBe('On phone only');
    expect(markerFor({ sync_state: 'syncing', recon_status: 'pending' }).icon).toBe('spinner');
    expect(markerFor({ sync_state: 'on_server', recon_status: 'match' }).icon).toBe('check');
    expect(markerFor({ sync_state: 'on_server', recon_status: 'differs' }).icon).toBe('check_diff');
    expect(markerFor({ sync_state: 'needs_attention', recon_status: 'pending' }).icon).toBe(
      'warning',
    );
  });

  it('reminders: none before 3 days, then once a day, stronger words from 7 days', () => {
    const t0 = 1_000_000;
    expect(reminderFor(t0, 2, t0 + 2 * DAY, null).level).toBe('none');
    expect(reminderFor(t0, 2, t0 + 2 * DAY, null).nextAt).toBe(t0 + 3 * DAY);
    const first = reminderFor(t0, 2, t0 + 3 * DAY, null);
    expect(first.level).toBe('normal');
    expect(first.text).toMatch(/2 shifts are only on this phone/);
    expect(reminderFor(t0, 2, t0 + 3 * DAY + 3_600_000, t0 + 3 * DAY).level).toBe('none');
    expect(reminderFor(t0, 2, t0 + 4 * DAY, t0 + 3 * DAY).level).toBe('normal');
    const strong = reminderFor(t0, 1, t0 + 7 * DAY, t0 + 6 * DAY);
    expect(strong.level).toBe('strong');
    expect(strong.text).toMatch(/1 shift is only on this phone, for 7 days.*gone/);
    expect(reminderFor(null, 0, t0 + 9 * DAY, null).level).toBe('none');
  });

  it('storage thresholds are 200 MB and 50 MB; an unreadable value is unknown, not fine', () => {
    const mb = 1024 * 1024;
    expect([
      storageState(null),
      storageState(500 * mb),
      storageState(199 * mb),
      storageState(49 * mb),
    ]).toEqual(['unknown', 'normal', 'low', 'critical']);
  });

  it('colours and sentences for every connection state', () => {
    expect(buildStatus(base)).toMatchObject({ color: 'green', unsyncedShifts: 0, message: null });
    expect(buildStatus({ ...base, shifts: [open('on_server')] }).color).toBe('green');
    expect(
      buildStatus({ ...base, shifts: [open('local', 5000), open('local', 2000)] }),
    ).toMatchObject({
      color: 'yellow',
      unsyncedShifts: 2,
      unsyncedPoints: 200,
      oldestAt: 2010,
    });
    expect(buildStatus({ ...base, shifts: [open('local')], offline: true }).message).toBe(
      'Offline. Saved on your phone.',
    );
    expect(buildStatus({ ...base, halted: 'repair' })).toMatchObject({ color: 'red' });
    expect(buildStatus({ ...base, halted: 'repair' }).message).toMatch(/removed from your server/);
    expect(buildStatus({ ...base, halted: 'auth_problem' }).message).toBe(
      'Sign-in problem. Re-pair this phone.',
    );
    expect(buildStatus({ ...base, wrongServer: true }).message).toMatch(
      /different MileWage server.*Nothing was sent/,
    );
    expect(buildStatus({ ...base, shifts: [open('needs_attention')] }).color).toBe('red');
    expect(buildStatus({ ...base, parkedItems: 1 }).color).toBe('red');
    expect(buildStatus({ ...base, storage: 'low' })).toMatchObject({ color: 'yellow' });
    expect(buildStatus({ ...base, storage: 'critical' })).toMatchObject({ color: 'red' });
    expect(buildStatus({ ...base, restored: true }).message).toMatch(/restored from a backup/);
  });
});

describe('wrong server and restore generation', () => {
  const headers = (instance: string | null, gen?: number) => {
    const h: Record<string, string> = {};
    if (instance) h['X-MileWage-Instance'] = instance;
    if (gen !== undefined) h['X-MileWage-Restore-Gen'] = String(gen);
    return h;
  };

  it('a different instance stops every request, keeps the data, and clears when the driver says so', async () => {
    let inst = 'inst-A';
    const srv = mockServer({
      'GET /settings': () => json(200, SETTINGS, headers(inst, 1)),
      'POST /shifts': () => json(201, {}, headers(inst, 1)),
      [`POST /shifts/${ID}/end`]: () => json(200, {}, headers(inst, 1)),
    });
    const { services, secure } = makeServices(srv.fetch, { paired: true });
    secure.data.set(
      'pairing.credential',
      JSON.stringify({
        baseUrl: 'https://mw.example.net',
        deviceId: 7,
        deviceToken: 'mwd_b',
        instanceId: 'inst-A',
      }),
    );
    await services.shift.start({ vehicleId: 3 });
    await services.shift.end();
    inst = 'inst-B'; // the address now answers as another server
    await services.outbox.enqueue('shift.patch', ID, { notes: 'x', updated_at: 1 });
    await services.sync.drain();
    expect(services.monitor.wrongServer).toBe(true);
    const sent = srv.calls.length;
    await services.sync.drain();
    await services.puller.pull({ force: true });
    expect(srv.calls.length).toBe(sent); // nothing more went out
    expect((await services.outbox.counts()).pending).toBeGreaterThan(0);
    expect((await services.status()).message).toMatch(/different MileWage server/);
    inst = 'inst-A';
    services.monitor.clearWrongServer();
    await services.sync.drain();
    expect(services.monitor.wrongServer).toBe(false);
  });

  it('an answer without the headers (captive portal) is not a wrong server', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    const m = new ConnectionMonitor(db);
    m.observe(new Headers(), 'inst-A');
    expect(m.wrongServer).toBe(false);
  });

  it('a higher restore generation marks shifts "on phone only" again and blocks eviction', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    await db.runAsync(
      `INSERT INTO shifts (client_id, vehicle_id, status, segmenter, started_at, local_date, updated_at, sync_state,
         server_deduction_cents, server_deduction_known)
       VALUES ('a', 3, 'ended', 'whole_shift', 1, '2026-11-01', 1, 'on_server', 99, 1)`,
    );
    const m = new ConnectionMonitor(db);
    m.observe(new Headers({ 'X-MileWage-Instance': 'i', 'X-MileWage-Restore-Gen': '2' }), 'i');
    await m.settled();
    expect(m.restored).toBe(false); // first sight of a generation only records it
    m.observe(new Headers({ 'X-MileWage-Instance': 'i', 'X-MileWage-Restore-Gen': '2' }), 'i');
    await m.settled();
    expect(m.restored).toBe(false);
    m.observe(new Headers({ 'X-MileWage-Instance': 'i', 'X-MileWage-Restore-Gen': '3' }), 'i');
    await m.settled();
    expect(m.restored).toBe(true);
    // The restored server may value the shift differently: the phone estimates until it is resent.
    expect(await db.getFirstAsync('SELECT sync_state, server_deduction_known FROM shifts')).toEqual(
      { sync_state: 'local', server_deduction_known: 0 },
    );
  });
});

describe('home banner', () => {
  it('shows what is not on the server, offers Sync now, and says so when a phone was revoked', async () => {
    let n = 0;
    const routes = server({
      'POST /shifts': () => (++n === 1 ? problem(503, 'x', true) : problem(401, 'device_revoked')),
    });
    const { services } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    await services.shift.end();
    render(<App services={services} />);
    expect(
      await screen.findByText(/Not yet on server: 1 shift · 0 points · oldest \d+ days ago/),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText(/removed from your server/)).toBeTruthy();
  });
});
