import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  BackupError,
  decryptStream,
  buildBackupService,
  nextRunAt,
  selectExcess,
  selectExpired,
  stamp,
} from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let recoveryKey: string;
let backupDir: string;
let configDir: string;
beforeEach(async () => {
  h = harness();
  backupDir = join(h.dir, 'backups');
  configDir = join(h.dir, 'config');
  ({ cookie, recoveryKey } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  const start = {
    client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
    vehicle_id: 1,
    started_at: h.clock.t,
  };
  expect((await h.call('POST', '/shifts', start, { cookie })).statusCode).toBe(201);
});
afterEach(() => h.close());

const service = () => buildBackupService({ db: h.db, now: () => h.clock.t, backupDir, configDir });
const files = (sub = '') => readdirSync(join(backupDir, sub)).filter((f) => f.endsWith('.gz.age'));
const readAll = async (s: Readable) => Buffer.concat(await s.toArray());
const day = 24 * 60 * 60 * 1000;

describe('engine and service', () => {
  test('a manual backup is verified, compressed, recorded and restorable', async () => {
    const row = (await service().run('manual'))!;
    const path = join(backupDir, row.fileName);
    expect(row.fileName).toBe(`milewage-${stamp(h.clock.t)}.db.gz.age`);
    expect(row.integrityOk).toBe(1);
    const bytes = readFileSync(path);
    expect(row.sizeBytes).toBe(bytes.length);
    expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    // The file is age-encrypted gzip of a database that has the live rows.
    const copyPath = join(h.dir, 'copy.db');
    writeFileSync(
      copyPath,
      gunzipSync(await readAll(await decryptStream(Readable.from(bytes), recoveryKey))),
    );
    const copy = new Database(copyPath, { readonly: true });
    expect(copy.prepare('SELECT count(*) FROM shifts').pluck().get()).toBe(1);
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.close();
    expect(readdirSync(join(backupDir, '.tmp'))).toEqual([]);
    expect(statMode(path)).toBe(0o600);
  });

  test('a copy that fails verification is rejected: no file, no row, older backups stay', async () => {
    const svc = service();
    const first = (await svc.run('manual'))!;
    h.clock.t += day;
    // A connection whose backup() loses the shifts, as a bad copy would.
    const lossy = Object.create(h.db) as typeof h.db;
    lossy.backup = (async (dest: string, opts: never) => {
      const result = await h.db.backup(dest, opts);
      const copy = new Database(dest);
      copy.pragma('foreign_keys = OFF');
      copy.exec('DELETE FROM shifts');
      copy.close();
      return result;
    }) as never;
    const bad = buildBackupService({ db: lossy, now: () => h.clock.t, backupDir, configDir });
    await expect(bad.run('manual')).rejects.toMatchObject({
      name: 'BackupError',
      reason: 'counts',
    });
    expect(bad.lastFailure()?.message).toMatch(/fewer rows in shifts/);
    expect(files()).toEqual([first.fileName]);
    expect(svc.list()).toHaveLength(1);
    expect(readdirSync(join(backupDir, '.tmp'))).toEqual([]);
  });

  test('a corrupted copy fails integrity_check', async () => {
    const corrupting = Object.create(h.db) as typeof h.db;
    corrupting.backup = (async (dest: string, opts: never) => {
      const result = await h.db.backup(dest, opts);
      const bytes = readFileSync(dest);
      bytes.fill(0xff, 4096, 4096 + 200); // damage page 2
      writeFileSync(dest, bytes);
      return result;
    }) as never;
    const svc = buildBackupService({ db: corrupting, now: () => h.clock.t, backupDir, configDir });
    const err = await svc.run('manual').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(files()).toEqual([]);
  });

  test('writes on the same connection continue while a backup runs, and the copy is consistent', async () => {
    const insert = h.db.prepare(
      "INSERT INTO vehicles (user_id, name, kind, created_at) VALUES (1, ?, 'car', 1)",
    );
    h.db.transaction(() => {
      for (let i = 0; i < 30_000; i++) insert.run(`vehicle number ${i} ${'x'.repeat(60)}`);
    })();
    const run = service().run('manual');
    let finished = false;
    void run.finally(() => (finished = true));
    let writesWhileRunning = 0;
    for (let i = 0; i < 200 && !finished; i++) {
      await new Promise((r) => setImmediate(r));
      if (!finished) {
        insert.run(`late ${i}`);
        writesWhileRunning++;
      }
    }
    const row = (await run)!;
    expect(row.integrityOk).toBe(1);
    expect(writesWhileRunning).toBeGreaterThan(0);
  });

  test('retention prunes only after success; pre-migration and pre-restore keep 3 and 2', async () => {
    const svc = service();
    for (let i = 0; i < 5; i++) {
      h.clock.t += 1000;
      await svc.run('pre_migration');
      await svc.run('pre_restore');
    }
    expect(files('pre-migration')).toHaveLength(3);
    expect(files('pre-restore')).toHaveLength(2);
    expect(svc.list().filter((r) => r.trigger === 'pre_migration')).toHaveLength(3);
    expect(files()).toEqual([]); // tiered backups are untouched by either
  });

  test('nightly runs prune through the tiers and keep the run rows in step with the files', async () => {
    const svc = service();
    for (let i = 0; i < 10; i++) {
      h.clock.t += day;
      await svc.run('nightly');
    }
    expect(files().length).toBeGreaterThanOrEqual(7);
    expect(svc.list().length).toBe(files().length);
  });

  test('no owner yet: nothing is backed up and nothing fails', async () => {
    const empty = harness();
    const svc = buildBackupService({
      db: empty.db,
      now: () => 1,
      backupDir: join(empty.dir, 'b'),
      configDir: join(empty.dir, 'c'),
    });
    expect(await svc.run('nightly')).toBeUndefined();
    await empty.close();
  });
});

describe('retention rules (10 section 5)', () => {
  const at = (iso: string) => `milewage-${stamp(Date.parse(iso))}.db.gz`;
  const dayList = (from: string, days: number, hour = '03:30:00.000') =>
    Array.from({ length: days }, (_, i) =>
      at(
        `${new Date(Date.parse(`${from}T${hour}Z`) + i * day).toISOString().slice(0, 10)}T${hour}Z`,
      ),
    );

  test('7 daily, 4 Sundays and 12 first-of-month days are kept; the rest are expired', () => {
    // One backup per day from 2025-10-01 to 2026-11-04 (Wednesday), UTC.
    const all = dayList('2025-10-01', 400);
    const expired = selectExpired(all, 'UTC');
    const kept = all.filter((n) => !expired.includes(n)).map((n) => n.slice(9, 17));
    const daily = [
      '20261104',
      '20261103',
      '20261102',
      '20261101',
      '20261031',
      '20261030',
      '20261029',
    ];
    const sundays = ['20261101', '20261025', '20261018', '20261011'];
    const firsts = [
      '20261101',
      '20261001',
      '20260901',
      '20260801',
      '20260701',
      '20260601',
      '20260501',
      '20260401',
      '20260301',
      '20260201',
      '20260101',
      '20251201',
    ];
    expect(new Set(kept)).toEqual(new Set([...daily, ...sundays, ...firsts]));
    expect(kept).toHaveLength(new Set([...daily, ...sundays, ...firsts]).size);
  });

  test('the newest file of a day wins, and the instance time zone decides the day', () => {
    const early = at('2026-11-02T03:30:00.000Z'); // Nov 1 local in Los Angeles: a Sunday and the 1st
    const late = at('2026-11-02T07:00:00.000Z'); // still Nov 1 local, newer
    const expired = selectExpired([early, late], 'America/Los_Angeles');
    expect(expired).toEqual([early]);
    // In UTC both are Nov 2, same day, newest wins as well.
    expect(selectExpired([early, late], 'UTC')).toEqual([early]);
  });

  test('foreign files are never touched, and selectExcess keeps the newest N', () => {
    expect(selectExpired(['notes.txt', '.tmp'], 'UTC')).toEqual([]);
    const names = dayList('2026-01-01', 5);
    expect(selectExcess(names, 3)).toEqual([names[1], names[0]]);
  });
});

describe('nightly schedule at local 03:30', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  test('UTC and a zone with an offset', () => {
    expect(iso(nextRunAt(Date.parse('2026-11-04T10:00:00Z'), 'UTC'))).toBe(
      '2026-11-05T03:30:00.000Z',
    );
    expect(iso(nextRunAt(Date.parse('2026-11-04T01:00:00Z'), 'UTC'))).toBe(
      '2026-11-04T03:30:00.000Z',
    );
    expect(iso(nextRunAt(Date.parse('2026-11-04T12:00:00Z'), 'America/Chicago'))).toBe(
      '2026-11-05T09:30:00.000Z',
    );
  });
  test('across both daylight-saving changes in Chicago', () => {
    // Fall back on 2026-11-01: 03:30 is CST (UTC-6).
    expect(iso(nextRunAt(Date.parse('2026-10-31T20:00:00Z'), 'America/Chicago'))).toBe(
      '2026-11-01T09:30:00.000Z',
    );
    // Spring forward on 2026-03-08: 03:30 is CDT (UTC-5).
    expect(iso(nextRunAt(Date.parse('2026-03-08T00:00:00Z'), 'America/Chicago'))).toBe(
      '2026-03-08T08:30:00.000Z',
    );
  });
});

describe('GET and POST /backups (08)', () => {
  test('run now, list, and the 15-minute limit', async () => {
    const first = await h.call('POST', '/backups', undefined, { cookie });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ id: 1, trigger: 'manual', integrity_ok: true });
    expect(first.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    const listed = await h.call('GET', '/backups', undefined, { cookie });
    expect(listed.json()).toEqual([first.json()]);
    h.clock.t += 5 * 60_000;
    const again = await h.call('POST', '/backups', undefined, { cookie });
    expect(again.statusCode).toBe(429);
    expect(again.json().code).toBe('backup_rate_limited');
    expect(again.headers['retry-after']).toBe('600');
    h.clock.t += 11 * 60_000;
    expect((await h.call('POST', '/backups', undefined, { cookie })).statusCode).toBe(201);
    expect(existsSync(backupDir)).toBe(true);
  });

  test('a session is required; a paired phone cannot start or list backups', async () => {
    expect((await h.call('GET', '/backups')).statusCode).toBe(401);
    expect((await h.call('POST', '/backups')).statusCode).toBe(401);
    const { auth } = await h.pair(cookie);
    expect((await h.call('GET', '/backups', undefined, auth)).statusCode).toBe(403);
  });
});

import { statSync } from 'node:fs';
const statMode = (path: string) => statSync(path).mode & 0o777;
