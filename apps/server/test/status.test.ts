import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { diskStateOf, DISK_LIMITS } from '../src/index';
import { harness, TRACKING_OFF, type Harness } from './support';

const MB = 1024 * 1024;
const GB = 1024 * MB;
let h: Harness;
let cookie: string;
let auth: { authorization: string };
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  ({ auth } = await h.pair(cookie));
});
afterEach(() => h.close());

describe('disk rules (10 section 11.3)', () => {
  test('thresholds: ok, warning, backup skipped, writes blocked', () => {
    const total = 500 * GB;
    expect(diskStateOf(100 * GB, total, 50 * MB)).toBe('ok');
    expect(diskStateOf(DISK_LIMITS.warnBelow, 5 * GB, 50 * MB)).toBe('ok'); // not below 1 GB
    expect(diskStateOf(DISK_LIMITS.warnBelow - 1, 5 * GB, 50 * MB)).toBe('warning');
    expect(diskStateOf(49 * GB, total, 50 * MB)).toBe('warning'); // under 10% of the volume
    expect(diskStateOf(50 * GB, total, 50 * MB)).toBe('ok');
    expect(diskStateOf(300 * MB, total, 200 * MB)).toBe('backup_skipped'); // below 2x the database
    expect(diskStateOf(400 * MB, total, 200 * MB)).toBe('warning'); // exactly 2x is enough
    expect(diskStateOf(200 * MB, total, 1)).toBe('warning'); // 200 MB is not "below 200 MB"
    expect(diskStateOf(200 * MB - 1, total, 1)).toBe('writes_blocked');
  });

  test('below 200 MB every write is 507 with the module on or off; reads and sign-in work', async () => {
    h.volume.free = 150 * MB;
    const writes: [string, string, object?][] = [
      ['POST', '/vehicles', { name: 'x', kind: 'car' }],
      ['PATCH', '/settings', { stops_enabled: false }],
      ['POST', '/pairing-tokens'],
      ['POST', '/backups'],
      [
        'POST',
        '/shifts',
        { client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11', vehicle_id: 1, started_at: 1 },
      ],
    ];
    for (const [method, url, body] of writes) {
      const res = await h.call(method, url, body, { cookie });
      expect([url, res.statusCode, res.json().code, res.headers['retry-after']]).toEqual([
        url,
        507,
        'insufficient_storage',
        '60',
      ]);
      expect(res.json().retryable).toBe(true);
    }
    // A phone's telemetry and diagnostics are writes too: it keeps buffering.
    const telemetry = await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: 'x', points: [] },
      auth,
    );
    expect([telemetry.statusCode, telemetry.json().code]).toEqual([507, 'insufficient_storage']);
    const diag = await h.call('POST', '/diagnostics/events', { events: [{}] }, auth);
    expect(diag.statusCode).toBe(507);

    // Reads, health, status, sign-in and sign-out keep working so the driver can get the records out.
    for (const url of [
      '/settings',
      '/vehicles',
      '/shifts',
      '/devices',
      '/backups',
      '/system/status',
    ]) {
      expect([url, (await h.call('GET', url, undefined, { cookie })).statusCode]).toEqual([
        url,
        200,
      ]);
    }
    expect((await h.app.inject('/healthz')).statusCode).toBe(200);
    const login = await h.call('POST', '/auth/login', {
      username: 'sam',
      password: 'correct horse battery',
    });
    expect(login.statusCode).toBe(204);
    const fresh = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await h.call('POST', '/auth/logout', undefined, { cookie })).statusCode).toBe(204);

    // Anonymous callers are refused as unauthenticated and learn nothing about the disk.
    const anon = await h.call('POST', '/vehicles', { name: 'x', kind: 'car' });
    expect(anon.statusCode).toBe(401);
    const redeem = await h.app.inject({
      method: 'POST',
      url: '/api/v1/pairing/redeem',
      payload: { token: 'x' },
    });
    expect(redeem.statusCode).not.toBe(507);

    // Space comes back: writes resume at once.
    h.volume.free = 5 * GB;
    expect(
      (await h.call('POST', '/vehicles', { name: 'x', kind: 'car' }, { cookie: fresh })).statusCode,
    ).toBe(201);
  });

  test('with the tracking and diagnostics modules off the 507 still applies (it lives in core)', async () => {
    const bare = harness({ ...TRACKING_OFF, devices: false, sync: false, diagnostics: false });
    const { cookie: c } = await bare.signUp();
    bare.volume.free = 10 * MB;
    expect(
      (await bare.call('POST', '/vehicles', { name: 'x', kind: 'car' }, { cookie: c })).statusCode,
    ).toBe(507);
    await bare.close();
  });

  test('a backup is skipped below twice the database size: 507, older backups kept, recovers', async () => {
    expect((await h.call('POST', '/backups', undefined, { cookie })).statusCode).toBe(201);
    h.clock.t += 16 * 60_000;
    h.volume.db = 400 * MB;
    h.volume.free = 700 * MB; // above 200 MB, below 2 x 400 MB
    expect((await h.call('GET', '/system/status', undefined, { cookie })).json().disk_state).toBe(
      'backup_skipped',
    );
    const res = await h.call('POST', '/backups', undefined, { cookie });
    expect([res.statusCode, res.json().code]).toEqual([507, 'insufficient_storage']);
    expect((await h.call('GET', '/backups', undefined, { cookie })).json()).toHaveLength(1);
    h.volume.free = 5 * GB;
    expect((await h.call('POST', '/backups', undefined, { cookie })).statusCode).toBe(201);
  });

  test('verbose diagnostics are accepted and discarded when the disk is not ok', async () => {
    await h.call('PATCH', '/settings', { diagnostics_level: 'verbose' }, { cookie });
    const event = (seq: number, level: string) => ({
      kind: 'upload.window',
      at: 1,
      level,
      src: 'phone_js',
      seq,
      v: '0.1.0',
      data: {
        attempts: 1,
        ok: 1,
        fail_net: 0,
        fail_4xx: 0,
        fail_5xx: 0,
        fail_429: 0,
        fail_507: 0,
        bytes_gz: 1,
        dur_p95_ms: 1,
        pending_points: 0,
        oldest_pending_s: 0,
      },
    });
    const send = (events: object[]) => h.call('POST', '/diagnostics/events', { events }, auth);
    expect((await send([event(1, 'verbose')])).json()).toMatchObject({ accepted: 1, discarded: 0 });
    h.volume.free = 800 * MB; // warning
    expect((await send([event(2, 'verbose'), event(3, 'basic')])).json()).toMatchObject({
      accepted: 1,
      discarded: 1,
    });
  });
});

describe('GET /system/status (08, 10 section 11.1)', () => {
  test('shape, device and anonymous access, and the live values', async () => {
    const res = await h.call('GET', '/system/status', undefined, { cookie });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      'app_version',
      'db_bytes',
      'diagnostics',
      'disk_free_bytes',
      'disk_state',
      'last_backup',
      'mode',
      'offsite',
      'paired_device_count',
      'schema_version',
      'sqlite_version',
      'wal_bytes',
    ]);
    expect(body).toMatchObject({
      app_version: '0.1.0',
      disk_state: 'ok',
      disk_free_bytes: 100 * GB,
      last_backup: null,
      mode: 'normal',
      paired_device_count: 1,
      offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: false },
      diagnostics: { level: 'basic', event_count: 0 },
    });
    expect(body.sqlite_version).toMatch(/^3\.\d+\.\d+/);
    expect(body.schema_version).toBeGreaterThan(5);
    expect(body.db_bytes).toBeGreaterThan(0);
    expect((await h.call('GET', '/system/status')).statusCode).toBe(401);
    expect((await h.call('GET', '/system/status', undefined, auth)).statusCode).toBe(403);
  });

  test('last backup, the off-site reminder and a revoked device', async () => {
    await h.call('POST', '/backups', undefined, { cookie });
    let body = (await h.call('GET', '/system/status', undefined, { cookie })).json();
    expect(body.last_backup).toMatchObject({ trigger: 'manual', integrity_ok: true });
    expect(body.offsite.reminder_due).toBe(true); // a backup exists, never downloaded, never acknowledged
    h.db
      .prepare('UPDATE settings SET offsite_synced_elsewhere_at = ?')
      .run(h.clock.t - 89 * 24 * 3600_000);
    body = (await h.call('GET', '/system/status', undefined, { cookie })).json();
    expect(body.offsite).toMatchObject({ reminder_due: false });
    h.clock.t += 2 * 24 * 3600_000; // 91 days since the acknowledgement: asked again
    body = (await h.call('GET', '/system/status', undefined, { cookie })).json();
    expect(body.offsite.reminder_due).toBe(true);
    h.db
      .prepare('UPDATE settings SET offsite_last_download_at = ?')
      .run(h.clock.t - 3 * 24 * 3600_000);
    expect(
      (await h.call('GET', '/system/status', undefined, { cookie })).json().offsite.reminder_due,
    ).toBe(false);
    await h.call('DELETE', '/devices/1', undefined, { cookie });
    expect(
      (await h.call('GET', '/system/status', undefined, { cookie })).json().paired_device_count,
    ).toBe(0);
  });

  test('mode shows a restore in progress; the diagnostics block is absent with the module off', async () => {
    h.state.set('restoring');
    expect((await h.call('GET', '/system/status', undefined, { cookie })).json().mode).toBe(
      'restoring',
    );
    h.state.set('normal');
    const off = harness({ diagnostics: false });
    const { cookie: c } = await off.signUp();
    const body = (await off.call('GET', '/system/status', undefined, { cookie: c })).json();
    expect(body.diagnostics).toBeUndefined();
    await off.close();
  });
});

describe('log rotation and pinned images in the compose file (10 sections 11.2, 12)', () => {
  const compose = parse(
    readFileSync(
      fileURLToPath(new URL('../../../infra/docker/docker-compose.yml', import.meta.url)),
      'utf8',
    ),
  ) as {
    services: Record<
      string,
      {
        image: string;
        logging?: { driver: string; options: Record<string, string> };
        environment?: string[];
      }
    >;
  };

  test('the api takes MILEWAGE_MODULE_MCP from .env, empty (module off) by default (plan 26)', () => {
    expect(compose.services.api!.environment).toContain(
      'MILEWAGE_MODULE_MCP=${MILEWAGE_MODULE_MCP:-}',
    );
  });

  test.each(['caddy', 'api'])('%s uses json-file with 10m x 3', (name) => {
    expect(compose.services[name]!.logging).toEqual({
      driver: 'json-file',
      options: { 'max-size': '10m', 'max-file': '3' },
    });
    expect(compose.services[name]!.image).not.toMatch(/:latest$|^[^:]+$/);
  });
});
