import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { healthChecks, type HealthInputs } from '../src/routes/health';
import { SERVER_VERSION, type UpdateFetcher } from '../src/index';
import { harness, type Harness } from './support';

const HOUR = 60 * 60 * 1000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const inputs = (over: Partial<HealthInputs> = {}): HealthInputs => ({
  now: 10 * HOUR,
  integrity: ['ok'],
  newestBackupAt: 9 * HOUR,
  backupsFailedCheck: false,
  diskFreeBytes: 50 * GB,
  clientTime: 10 * HOUR,
  updatesEnabled: true,
  updateError: null,
  updateCheckedAt: 1,
  version: '0.3.1',
  ...over,
});
const statusOf = (over: Partial<HealthInputs>, id: string) =>
  healthChecks(inputs(over)).find((c) => c.id === id)?.status;

describe('health checks', () => {
  test('a healthy server has nothing to fix', () => {
    const checks = healthChecks(inputs());
    expect(checks.map((c) => c.id)).toEqual([
      'database',
      'backup',
      'disk',
      'clock',
      'version',
      'updates',
    ]);
    expect(checks.every((c) => c.status === 'ok' && c.fix === null)).toBe(true);
  });

  test('database: anything but ok is a failure with a fix', () => {
    const c = healthChecks(inputs({ integrity: ['row 3 missing from index x'] }))[0]!;
    expect(c).toMatchObject({ id: 'database', status: 'fail' });
    expect(c.detail).toContain('row 3 missing');
    expect(c.fix).toMatch(/restore/i);
  });

  test('backup: none fails, over 36 hours warns, 36 hours exactly is fine', () => {
    expect(statusOf({ newestBackupAt: undefined }, 'backup')).toBe('fail');
    expect(statusOf({ newestBackupAt: undefined, backupsFailedCheck: true }, 'backup')).toBe(
      'fail',
    );
    expect(statusOf({ now: 40 * HOUR, newestBackupAt: 4 * HOUR }, 'backup')).toBe('ok');
    expect(statusOf({ now: 40 * HOUR, newestBackupAt: 4 * HOUR - 1 }, 'backup')).toBe('warn');
  });

  test('disk: warn under 2 GB, fail under 500 MB, and absent when not measured', () => {
    expect(statusOf({ diskFreeBytes: 2 * GB }, 'disk')).toBe('ok');
    expect(statusOf({ diskFreeBytes: 2 * GB - 1 }, 'disk')).toBe('warn');
    expect(statusOf({ diskFreeBytes: 500 * MB }, 'disk')).toBe('warn');
    expect(statusOf({ diskFreeBytes: 500 * MB - 1 }, 'disk')).toBe('fail');
    expect(statusOf({ diskFreeBytes: undefined }, 'disk')).toBeUndefined();
  });

  test('clock: warn over 2 minutes either way, absent without the browser time', () => {
    expect(statusOf({ clientTime: 10 * HOUR + 120_000 }, 'clock')).toBe('ok');
    expect(statusOf({ clientTime: 10 * HOUR + 120_001 }, 'clock')).toBe('warn');
    expect(statusOf({ clientTime: 10 * HOUR - 121_000 }, 'clock')).toBe('warn');
    expect(statusOf({ clientTime: undefined }, 'clock')).toBeUndefined();
  });

  test('update check: a failure warns only while the switch is on', () => {
    expect(statusOf({ updateError: 'offline' }, 'updates')).toBe('warn');
    expect(statusOf({ updateError: 'offline', updatesEnabled: false }, 'updates')).toBe('ok');
    expect(statusOf({ updateCheckedAt: null }, 'updates')).toBe('ok');
  });

  test('says nothing about Docker, ports or Tailscale: the server cannot see them', () => {
    const text = JSON.stringify(healthChecks(inputs()));
    expect(text).not.toMatch(/docker|tailscale|port/i);
  });
});

describe('GET /health/checks and POST /health/update-check', () => {
  let h: Harness;
  let cookie: string;
  const release = vi.fn<UpdateFetcher>();
  beforeEach(async () => {
    release.mockReset();
    release.mockResolvedValue({
      version: '99.0.0',
      url: 'https://github.com/raiz-toff/Milewage/releases/tag/v99.0.0',
    });
    h = harness({}, { fetchLatestRelease: release });
    ({ cookie } = await h.signUp());
  });
  afterEach(() => h.close());

  test('needs a web session, not a phone token and not nothing', async () => {
    expect((await h.call('GET', '/health/checks')).statusCode).toBe(401);
    expect((await h.call('POST', '/health/update-check')).statusCode).toBe(401);
    const { auth } = await h.pair(cookie);
    expect((await h.call('GET', '/health/checks', undefined, auth)).statusCode).toBe(403);
    expect((await h.call('POST', '/health/update-check', undefined, auth)).statusCode).toBe(403);
  });

  test('reports the checks the server can make, with the clock from the page', async () => {
    const res = await h.call(
      'GET',
      `/health/checks?client_time=${h.clock.t + 10 * 60_000}`,
      undefined,
      {
        cookie,
      },
    );
    expect(res.statusCode).toBe(200);
    const { checks, update } = res.json();
    const by = Object.fromEntries(checks.map((c: { id: string }) => [c.id, c]));
    expect(by.database.status).toBe('ok');
    expect(by.backup.status).toBe('fail'); // none yet
    expect(by.disk.status).toBe('ok');
    expect(by.clock.status).toBe('warn');
    expect(by.version.detail).toContain(SERVER_VERSION);
    expect(update).toMatchObject({
      enabled: true,
      available: false,
      current_version: SERVER_VERSION,
    });
    // No client time, no clock check.
    const bare = await h.call('GET', '/health/checks', undefined, { cookie });
    expect(bare.json().checks.map((c: { id: string }) => c.id)).not.toContain('clock');
  });

  test('a backup makes the backup check pass, an old one warns', async () => {
    await h.call('POST', '/backups', undefined, { cookie });
    const ok = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(ok.checks.find((c: { id: string }) => c.id === 'backup').status).toBe('ok');
    h.clock.t += 37 * HOUR;
    const old = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(old.checks.find((c: { id: string }) => c.id === 'backup').status).toBe('warn');
  });

  test('free disk space follows the volume', async () => {
    h.volume.free = 1 * GB;
    const warn = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(warn.checks.find((c: { id: string }) => c.id === 'disk').status).toBe('warn');
    h.volume.free = 300 * MB;
    const fail = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(fail.checks.find((c: { id: string }) => c.id === 'disk').status).toBe('fail');
  });

  test('a rejected client_time is a 422', async () => {
    const res = await h.call('GET', '/health/checks?client_time=soon', undefined, { cookie });
    expect(res.statusCode).toBe(422);
  });

  test('Check now asks the injected fetcher once and reports the newer version', async () => {
    expect(release).not.toHaveBeenCalled(); // nothing on its own in a test
    const res = await h.call('POST', '/health/update-check', undefined, { cookie });
    expect(res.statusCode).toBe(200);
    expect(release).toHaveBeenCalledTimes(1);
    expect(res.json()).toMatchObject({
      available: true,
      latest_version: '99.0.0',
      notes_url: 'https://github.com/raiz-toff/Milewage/releases/tag/v99.0.0',
      checked_at: h.clock.t,
      check_failed: false,
    });
    const report = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(report.update.available).toBe(true);
  });

  test('a failed check is a quiet warning on the page, never an error', async () => {
    release.mockRejectedValue(new Error('offline'));
    const res = await h.call('POST', '/health/update-check', undefined, { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, checked_at: null, check_failed: true });
    const report = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(report.checks.find((c: { id: string }) => c.id === 'updates')).toMatchObject({
      status: 'warn',
    });
  });

  test('the switch is a stored setting, on by default, and turns the warning off', async () => {
    const before = (await h.call('GET', '/settings', undefined, { cookie })).json();
    expect(before.update_check_enabled).toBe(true);
    const patched = await h.call('PATCH', '/settings', { update_check_enabled: false }, { cookie });
    expect(patched.json().update_check_enabled).toBe(false);
    release.mockRejectedValue(new Error('offline'));
    await h.call('POST', '/health/update-check', undefined, { cookie });
    const report = (await h.call('GET', '/health/checks', undefined, { cookie })).json();
    expect(report.update.enabled).toBe(false);
    expect(report.checks.find((c: { id: string }) => c.id === 'updates').status).toBe('ok');
  });

  test('a server without a fetcher never calls out', async () => {
    const quiet = harness();
    const { cookie: c } = await quiet.signUp();
    const res = await quiet.call('POST', '/health/update-check', undefined, { cookie: c });
    expect(res.json()).toMatchObject({ available: false });
    await quiet.close();
  });
});
