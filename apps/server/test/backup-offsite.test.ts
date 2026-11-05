import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ride, SHIFT, toWire } from './rides';
import { loadConfig } from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const backupDir = () => join(h.dir, 'backups');
const status = async () => (await web('GET', '/system/status')).json();

async function start(extra: Parameters<typeof harness>[1] = {}) {
  h = harness({}, extra);
  ({ cookie } = await h.signUp());
}
afterEach(() => h.close());

describe('GET /backups/{id}/download and PUT /backups/offsite-ack (10 section 6)', () => {
  beforeEach(() => start());

  test('the encrypted file is handed out as it is on disk, and the reminder resets', async () => {
    const made = (await web('POST', '/backups')).json();
    expect((await status()).offsite.reminder_due).toBe(true);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/backups/${made.id}/download`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(String(res.headers['content-disposition'])).toMatch(
      /^attachment; filename="milewage-.*\.db\.gz\.age"$/,
    );
    const bytes = res.rawPayload;
    expect(bytes.length).toBe(made.size_bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(made.sha256);
    expect(bytes.subarray(0, 21).toString()).toBe('age-encryption.org/v1'); // not the raw database
    const after = await status();
    expect(after.offsite).toEqual({
      last_download_at: h.clock.t,
      synced_elsewhere_at: null,
      reminder_due: false,
    });
    // 31 days later the reminder is back.
    h.db.prepare('UPDATE web_sessions SET expires_at = expires_at + 365 * 86400000').run();
    h.clock.t += 31 * 24 * 3600_000;
    expect((await status()).offsite.reminder_due).toBe(true);
  });

  test('unknown id, a missing file and a phone are refused', async () => {
    expect((await web('GET', '/backups/99/download')).json().code).toBe('not_found');
    const made = (await web('POST', '/backups')).json();
    rmSync(
      join(backupDir(), h.db.prepare('SELECT file_name FROM backup_runs').pluck().get() as string),
    );
    expect((await web('GET', `/backups/${made.id}/download`)).statusCode).toBe(404);
    expect((await h.call('GET', `/backups/${made.id}/download`)).statusCode).toBe(401);
    const { auth } = await h.pair(cookie);
    expect((await h.call('GET', `/backups/${made.id}/download`, undefined, auth)).statusCode).toBe(
      403,
    );
    expect((await web('GET', '/backups/abc/download')).statusCode).toBe(422);
  });

  test('a row that failed verification is never handed out', async () => {
    const made = (await web('POST', '/backups')).json();
    h.db.prepare('UPDATE backup_runs SET integrity_ok = 0').run();
    expect((await web('GET', `/backups/${made.id}/download`)).statusCode).toBe(404);
  });

  test('"my folder is synced elsewhere" silences the reminder for 90 days, then it asks again', async () => {
    await web('POST', '/backups');
    expect((await status()).offsite.reminder_due).toBe(true);
    const ack = await web('PUT', '/backups/offsite-ack', { synced_elsewhere: true });
    expect(ack.json()).toEqual({
      last_download_at: null,
      synced_elsewhere_at: h.clock.t,
      reminder_due: false,
    });
    expect((await status()).offsite.reminder_due).toBe(false);
    const asked = h.clock.t;
    h.clock.t += 89 * 24 * 3600_000;
    h.db.prepare('UPDATE web_sessions SET expires_at = expires_at + 365 * 86400000').run();
    expect((await status()).offsite.reminder_due).toBe(false);
    h.clock.t += 2 * 24 * 3600_000;
    expect((await status()).offsite).toEqual({
      last_download_at: null,
      synced_elsewhere_at: asked,
      reminder_due: true,
    });
    const off = await web('PUT', '/backups/offsite-ack', { synced_elsewhere: false });
    expect(off.json().synced_elsewhere_at).toBeNull();
    for (const bad of [{}, { synced_elsewhere: 'yes' }, { synced_elsewhere: true, x: 1 }]) {
      expect((await web('PUT', '/backups/offsite-ack', bad)).statusCode).toBe(422);
    }
    expect(
      (await h.call('PUT', '/backups/offsite-ack', { synced_elsewhere: true })).statusCode,
    ).toBe(401);
  });

  test('a reminder only exists once there is a backup', async () => {
    expect((await status()).offsite.reminder_due).toBe(false);
    expect(
      (await web('PUT', '/backups/offsite-ack', { synced_elsewhere: false })).json().reminder_due,
    ).toBe(false);
  });

  test('GET /settings reports backup_download', async () => {
    expect((await web('GET', '/settings')).json().modules.backup_download).toBe(true);
  });
});

describe('backup.download off', () => {
  test('both routes are 404 and the flag says so', async () => {
    await start({ backupDownload: false });
    const made = (await web('POST', '/backups')).json();
    expect((await web('GET', `/backups/${made.id}/download`)).json().code).toBe('not_found');
    expect((await web('PUT', '/backups/offsite-ack', { synced_elsewhere: true })).json().code).toBe(
      'not_found',
    );
    expect((await web('GET', '/settings')).json().modules.backup_download).toBe(false);
    expect(existsSync(backupDir())).toBe(true); // the engine itself still runs
  });
});

describe('shift.ended triggers a backup (backup.on_shift_end)', () => {
  const runShift = async () => {
    await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    const { auth } = await h.pair(cookie);
    const t0 = h.clock.t;
    const fixes = ride(t0).slice(0, 100);
    h.clock.t = t0 + 600_000;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.map(toWire) },
      auth,
    );
    return h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: t0 + 500_000 }, auth);
  };
  const runs = () => h.db.prepare('SELECT trigger FROM backup_runs').pluck().all();
  const newest = () =>
    (h.db.prepare('SELECT max(id) FROM backup_runs').pluck().get() as number | null) ?? 0;
  const settle = async (n: number) => {
    for (let i = 0; i < 200 && runs().length < n; i++) await new Promise((r) => setTimeout(r, 25));
  };

  test(
    'a verified shift_end backup follows the end, and only one per 15 minutes',
    { timeout: 30_000 },
    async () => {
      await start({ backupOnShiftEnd: true });
      expect((await runShift()).statusCode).toBe(200);
      await settle(1);
      expect(runs()).toEqual(['shift_end']);
      // A second shift 5 minutes later does not make another backup.
      h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
      h.clock.t += 5 * 60_000;
      const fresh = '33333333-3333-4333-8333-333333333333';
      const { auth } = await h.pair(cookie);
      await h.call(
        'POST',
        '/shifts',
        { client_id: fresh, vehicle_id: 1, started_at: h.clock.t },
        auth,
      );
      await h.call('POST', `/shifts/${fresh}/end`, { ended_at: h.clock.t + 1000 }, auth);
      await new Promise((r) => setTimeout(r, 300));
      expect(runs()).toEqual(['shift_end']);
      // Past the limit the next end backs up again.
      h.clock.t += 11 * 60_000;
      const third = '44444444-4444-4444-8444-444444444444';
      await h.call(
        'POST',
        '/shifts',
        { client_id: third, vehicle_id: 1, started_at: h.clock.t },
        auth,
      );
      await h.call('POST', `/shifts/${third}/end`, { ended_at: h.clock.t + 1000 }, auth);
      // Retention keeps the newest backup of the day, so the second run replaces the first row.
      for (let i = 0; i < 400 && newest() < 2; i++) await new Promise((r) => setTimeout(r, 25));
      expect(newest()).toBe(2);
      expect(runs()).toEqual(['shift_end']);
      // The file exists and decrypts-ready (age header).
      const file = h.db.prepare('SELECT file_name FROM backup_runs').pluck().get() as string;
      expect(readFileSync(join(backupDir(), file)).subarray(0, 21).toString()).toBe(
        'age-encryption.org/v1',
      );
    },
  );

  test('off by configuration: no backup follows the end', async () => {
    await start({ backupOnShiftEnd: false });
    await runShift();
    await new Promise((r) => setTimeout(r, 300));
    expect(runs()).toEqual([]);
  });
});

describe('backup switches in the configuration', () => {
  const load = (env: Record<string, string>) =>
    loadConfig({ MILEWAGE_CONFIG_DIR: join(tmpdir(), 'mw-no-such-config'), ...env }).backup;
  test('both are on by default and the environment turns each off', () => {
    expect(load({})).toEqual({ onShiftEnd: true, download: true });
    expect(load({ MILEWAGE_BACKUP_ON_SHIFT_END: '0' })).toEqual({
      onShiftEnd: false,
      download: true,
    });
    expect(load({ MILEWAGE_BACKUP_DOWNLOAD: '0' })).toEqual({ onShiftEnd: true, download: false });
    expect(() => load({ MILEWAGE_BACKUP_DOWNLOAD: 'no' })).toThrow('0 or 1');
  });
});
