import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildBackupService,
  createRestoreService,
  fileSecrets,
  generateRecoveryKey,
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
  recipientOf,
} from '../src/index';
import { harness, owner, type Harness } from './support';

let source: Harness; // the instance that is backed up
let fresh: Harness; // a new host
let key: string;
let backupFile: string;
const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';

const serviceFor = (h: Harness, verify?: (db: Harness['db']) => void) => {
  const configDir = join(h.dir, 'config');
  const backup = buildBackupService({
    db: h.db,
    now: () => h.clock.t,
    backupDir: join(h.dir, 'backups'),
    configDir,
  });
  return {
    backup,
    restore: createRestoreService({
      db: h.db,
      backup,
      secrets: fileSecrets(configDir),
      state: h.state,
      verify,
    }),
  };
};

beforeEach(async () => {
  source = harness();
  const { cookie, recoveryKey } = await source.signUp();
  key = recoveryKey;
  await source.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  const { auth } = await source.pair(cookie);
  const t0 = source.clock.t;
  const start = { client_id: SHIFT, vehicle_id: 1, started_at: t0 };
  await source.call('POST', '/shifts', start, auth);
  const points = [1, 2, 3].map((seq) => ({
    seq,
    recorded_at: t0 + seq * 1000,
    lat_e7: 377749290,
    lon_e7: -1224194160,
    accuracy_m: 5,
  }));
  source.clock.t += 60_000;
  const up = await source.app.inject({
    method: 'POST',
    url: '/api/v1/telemetry/batch',
    headers: { 'content-type': 'application/json', ...auth },
    payload: { shift_client_id: SHIFT, points },
  });
  expect(up.statusCode).toBe(200);
  source.db.prepare('UPDATE instance SET restore_generation = 2 WHERE id = 1').run();
  const row = (await serviceFor(source).backup.run('manual'))!;
  backupFile = join(source.dir, 'backups', row.fileName);
  fresh = harness();
});
afterEach(async () => {
  await source.close();
  await fresh.close();
});

function multipart(parts: { name: string; value: string | Buffer; filename?: string }[]) {
  const boundary = '----mwtest';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = `form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}`;
    const type = p.filename ? 'Content-Type: application/octet-stream\r\n' : '';
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`));
    chunks.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}
const postRestore = (h: Harness, recoveryKey: string, file: Buffer = readFileSync(backupFile)) => {
  const { payload, type } = multipart([
    { name: 'file', value: file, filename: 'backup.db.gz.age' },
    { name: 'recovery_key', value: recoveryKey },
  ]);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/setup/restore',
    headers: { 'content-type': type },
    payload,
  });
};
const count = (h: Harness, table: string) =>
  h.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

describe('POST /setup/restore on a fresh host (10 section 7)', () => {
  test('restores everything, prints the verification, bumps the generation, keeps the instance id', async () => {
    const res = await postRestore(fresh, key);
    expect(res.statusCode).toBe(200);
    const sourceId = source.db.prepare('SELECT instance_id FROM instance').pluck().get();
    expect(res.json()).toMatchObject({
      integrity_ok: true,
      shift_count: 1,
      stop_label_count: 0,
      point_count: 3,
      first_shift_at: 1_800_000_000_000,
      last_shift_at: 1_800_000_000_000,
      latest_shift_total_m: null,
      instance_id: sourceId,
      restore_generation: 3, // max(live 0, restored 2) + 1
    });
    expect(res.json().schema_version).toBeGreaterThan(5);
    expect(res.headers['x-milewage-restore-gen']).toBe('3');
    expect(res.headers['x-milewage-instance']).toBe(sourceId);

    // The old owner can sign in; the data is there; the instance is ready.
    expect((await fresh.call('GET', '/setup/status')).json()).toEqual({ state: 'ready' });
    const login = await fresh.call('POST', '/auth/login', {
      username: owner.username,
      password: owner.password,
    });
    expect(login.statusCode).toBe(204);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await fresh.call('GET', '/shifts', undefined, { cookie })).json().items).toHaveLength(
      1,
    );
    expect(count(fresh, 'telemetry_points')).toBe(3);
    // Later backups on this host are readable with the card the driver holds.
    const secrets = JSON.parse(readFileSync(join(fresh.dir, 'config', 'secrets.json'), 'utf8'));
    expect(secrets.age_public_key).toBe(await recipientOf(key));
    expect(fresh.state.mode).toBe('normal');
    expect(existsSync(join(fresh.dir, '.restore-tmp'))).toBe(false);
  });

  test('refused with 409 once any user exists: nothing is touched', async () => {
    await fresh.signUp();
    const before = count(fresh, 'users');
    const res = await postRestore(fresh, key);
    expect([res.statusCode, res.json().code]).toEqual([409, 'setup_already_done']);
    expect([count(fresh, 'users'), count(fresh, 'shifts')]).toEqual([before, 0]);
  });

  test('a wrong key or a damaged file is 422, leaves the host empty, and 5 failures lock it', async () => {
    const other = await generateRecoveryKey();
    for (let i = 0; i < 5; i++) {
      const res = await postRestore(fresh, other.identity);
      expect([res.statusCode, res.json().errors[0].path]).toEqual([422, '/recovery_key']);
    }
    const locked = await postRestore(fresh, other.identity);
    expect([locked.statusCode, locked.json().code]).toEqual([429, 'rate_limited']);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(count(fresh, 'users')).toBe(0);
    expect(fresh.state.mode).toBe('normal');
    expect((await fresh.call('GET', '/setup/status')).json()).toEqual({ state: 'needs_setup' });
  });

  test('a damaged file and malformed requests are refused before anything changes', async () => {
    const damaged = readFileSync(backupFile);
    damaged[damaged.length - 5]! ^= 0xff;
    expect((await postRestore(fresh, key, damaged)).statusCode).toBe(422);
    expect((await postRestore(fresh, 'not a key')).statusCode).toBe(422);
    const noKey = multipart([{ name: 'file', value: Buffer.from('x'), filename: 'f' }]);
    const missing = await fresh.app.inject({
      method: 'POST',
      url: '/api/v1/setup/restore',
      headers: { 'content-type': noKey.type },
      payload: noKey.payload,
    });
    expect([missing.statusCode, missing.json().errors[0].path]).toEqual([422, '/recovery_key']);
    const json = await fresh.app.inject({
      method: 'POST',
      url: '/api/v1/setup/restore',
      payload: { recovery_key: key },
    });
    expect(json.statusCode).toBe(415);
    expect(count(fresh, 'users')).toBe(0);
  });

  test('a backup from a newer MileWage aborts before touching live data', async () => {
    source.db.prepare("INSERT INTO schema_migrations VALUES ('core', '9999_future', 1)").run();
    source.clock.t += 60_000;
    const row = (await serviceFor(source).backup.run('manual'))!;
    const file = readFileSync(join(source.dir, 'backups', row.fileName));
    const res = await postRestore(fresh, key, file);
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toMatch(/newer MileWage/);
    expect(count(fresh, 'users')).toBe(0);
    expect(fresh.state.mode).toBe('normal');
  });

  test('an older backup is migrated forward in the scratch copy, then restored', async () => {
    // A database from before migration 0006 (no instance.setup_confirmed_at).
    const old = harness();
    old.db.close();
    const oldDb = new Database(join(old.dir, 'old.db'));
    oldDb.pragma('foreign_keys = ON');
    const older = loadMigrations(MIGRATIONS_DIR).filter((m) => !m.id.startsWith('0006'));
    migrate(oldDb, older);
    oldDb.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
      INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at) VALUES (1,'US','mi','USD','UTC',1);
      INSERT INTO instance (id, instance_id) VALUES (1, 'old-instance');`);
    const identity = await generateRecoveryKey();
    const configDir = join(old.dir, 'config');
    fileSecrets(configDir).write({ age_public_key: identity.recipient });
    const backup = buildBackupService({
      db: oldDb as never,
      now: () => 1_800_000_000_000,
      backupDir: join(old.dir, 'b'),
      configDir,
    });
    const row = (await backup.run('manual'))!;
    const file = readFileSync(join(old.dir, 'b', row.fileName));
    oldDb.close();
    await old.close().catch(() => undefined);

    const res = await postRestore(fresh, identity.identity, file);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ instance_id: 'old-instance', restore_generation: 1 });
    const confirmed = fresh.db.prepare('SELECT setup_confirmed_at FROM instance').pluck().get();
    expect(confirmed).toBe(0); // backfilled by 0006, so the restored instance is ready
    expect((await fresh.call('GET', '/setup/status')).json()).toEqual({ state: 'ready' });
  });

  test('while a restore runs the API answers 503 restoring, except the status route', async () => {
    fresh.state.set('restoring');
    const blocked = await fresh.call('GET', '/vehicles');
    expect([blocked.statusCode, blocked.json().code, blocked.headers['retry-after']]).toEqual([
      503,
      'restoring',
      '5',
    ]);
    expect((await fresh.call('GET', '/setup/status')).statusCode).toBe(200);
    expect((await fresh.app.inject('/healthz')).statusCode).toBe(200);
    fresh.state.set('normal');
    expect((await fresh.call('GET', '/vehicles')).statusCode).not.toBe(503);
  });
});

describe('restore over live data: safety copy and automatic revert', () => {
  let live: Harness;
  beforeEach(async () => {
    live = harness();
    const { cookie } = await live.signUp();
    await live.call('POST', '/vehicles', { name: 'Van', kind: 'van' }, { cookie });
    live.db.prepare('UPDATE instance SET restore_generation = 7 WHERE id = 1').run();
  });
  afterEach(() => live.close());

  const liveSnapshot = () => ({
    vehicles: live.db.prepare('SELECT name FROM vehicles').pluck().all(),
    shifts: count(live, 'shifts'),
    instance: live.db.prepare('SELECT instance_id, restore_generation FROM instance').get(),
  });

  test('a failed verification rolls everything back; the safety copy exists', async () => {
    const before = liveSnapshot();
    const { restore } = serviceFor(live, () => {
      throw new Error('forced verification failure');
    });
    await expect(restore.restore(backupFile, key, true)).rejects.toMatchObject({
      code: 'internal_error',
    });
    expect(liveSnapshot()).toEqual(before);
    expect(live.state.mode).toBe('normal');
    const safety = readdirSync(join(live.dir, 'backups', 'pre-restore'));
    expect(safety).toHaveLength(1);
    // Foreign keys are back on after the swap attempt.
    expect(live.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(existsSync(join(live.dir, '.restore-tmp'))).toBe(false);
  });

  test('a successful restore replaces the data and sets the generation past both counters', async () => {
    const { restore } = serviceFor(live);
    const result = await restore.restore(backupFile, key, true);
    expect(result).toMatchObject({ shift_count: 1, point_count: 3, restore_generation: 8 });
    expect(liveSnapshot().vehicles).toEqual(['Civic']);
    expect(readdirSync(join(live.dir, 'backups', 'pre-restore'))).toHaveLength(1);
    mkdirSync(join(live.dir, 'x'), { recursive: true });
  });

  test('without allowExisting the service refuses a populated instance', async () => {
    const { restore } = serviceFor(live);
    await expect(restore.restore(backupFile, key, false)).rejects.toMatchObject({
      code: 'setup_already_done',
    });
  });
});
