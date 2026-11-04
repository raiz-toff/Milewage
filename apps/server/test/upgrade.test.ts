import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildBackupService,
  createServerState,
  fileSecrets,
  generateRecoveryKey,
  loadMigrations,
  migrate,
  MIGRATIONS_DIR,
  MigrationError,
  openDatabase,
  upgradeDatabase,
  type Migration,
} from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
beforeEach(() => void (h = harness()));
afterEach(() => h.close());

const bundled = () => loadMigrations(MIGRATIONS_DIR);
const probe: Migration = {
  module: 'core',
  id: '9001_probe',
  sql: 'CREATE TABLE upgrade_probe (x INTEGER);',
};
const failing: Migration = {
  module: 'core',
  id: '9002_fails_halfway',
  sql: 'CREATE TABLE half_done (x INTEGER); INSERT INTO table_that_does_not_exist VALUES (1);',
};
const service = () =>
  buildBackupService({
    db: h.db,
    now: () => h.clock.t,
    backupDir: join(h.dir, 'backups'),
    configDir: join(h.dir, 'config'),
  });
const upgrade = (migrations: Migration[]) =>
  upgradeDatabase({ db: h.db, backup: service(), state: h.state, migrations });
const tables = () =>
  h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[];
const applied = () => h.db.prepare('SELECT count(*) FROM schema_migrations').pluck().get();
const preMigrationFiles = () => {
  const dir = join(h.dir, 'backups', 'pre-migration');
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('upgrade flow (10 section 10)', () => {
  test('nothing pending: nothing happens', async () => {
    await h.signUp();
    await upgrade(bundled());
    expect(h.state.migration).toEqual({ status: 'none', pending: [], backup: null });
    expect(preMigrationFiles()).toEqual([]);
  });

  test('with data, a verified pre-migration backup comes first, then the migration is recorded', async () => {
    await h.signUp();
    await upgrade([...bundled(), probe]);
    const files = preMigrationFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.db\.gz\.age$/);
    expect(tables()).toContain('upgrade_probe');
    expect(h.state.mode).toBe('normal');
    expect(h.state.migration).toMatchObject({
      status: 'applied',
      pending: ['core/9001_probe'],
      backup: `pre-migration/${files[0]}`,
    });
    // The backup is listed in backup_runs once the table is current.
    const rows = h.db
      .prepare("SELECT file_name, integrity_ok FROM backup_runs WHERE trigger = 'pre_migration'")
      .all();
    expect(rows).toEqual([{ file_name: `pre-migration/${files[0]}`, integrity_ok: 1 }]);
  });

  test('a failing migration leaves the old schema intact and the server read-only', async () => {
    const { cookie } = await h.signUp();
    const before = { tables: tables().sort(), applied: applied() };
    await upgrade([...bundled(), failing]);
    expect(tables().sort()).toEqual(before.tables); // half_done was rolled back with the rest
    expect(applied()).toBe(before.applied);
    expect(h.state.mode).toBe('read_only');
    expect(h.state.migration.status).toBe('failed');
    expect(h.state.migration.error).toMatch(/rolled back/);
    expect(preMigrationFiles()).toHaveLength(1); // the way back
    expect(h.state.reason).toMatch(/pre-migration\/milewage-.*\.db\.gz\.age/);

    // Over HTTP: code and schema disagree, so everything but the status route is 503 read_only_mode.
    for (const [method, url] of [
      ['GET', '/vehicles'],
      ['POST', '/vehicles'],
    ] as const) {
      const res = await h.call(
        method,
        url,
        method === 'POST' ? { name: 'x', kind: 'car' } : undefined,
        { cookie },
      );
      expect([url, res.statusCode, res.json().code, res.headers['retry-after']]).toEqual([
        url,
        503,
        'read_only_mode',
        '30',
      ]);
      expect(res.json().retryable).toBe(true);
    }
    expect((await h.app.inject('/healthz')).statusCode).toBe(200);
  });

  test('a failed pre-migration backup stops the migration: no write happens', async () => {
    await h.signUp();
    fileSecrets(join(h.dir, 'config')).write({ age_public_key: '' }); // the backup cannot be made
    const before = applied();
    await upgrade([...bundled(), probe]);
    expect(applied()).toBe(before);
    expect(tables()).not.toContain('upgrade_probe');
    expect(h.state.mode).toBe('read_only');
    expect(h.state.migration).toMatchObject({ status: 'blocked', backup: null });
    expect(h.state.migration.error).toMatch(/pre-migration backup failed/);
    expect(preMigrationFiles()).toEqual([]);
  });

  test('read-only after a blocked upgrade: writes are 503 with the reason, status route stays open', async () => {
    h.state.migration = {
      status: 'blocked',
      pending: ['core/x'],
      backup: null,
      error: 'disk full',
    };
    h.state.set('read_only', 'Upgrade paused. disk full');
    const write = await h.call('POST', '/auth/login', { username: 'a', password: 'b' });
    expect([write.statusCode, write.json().code]).toEqual([503, 'read_only_mode']);
    expect(write.json().detail).toBe('Upgrade paused. disk full');
    expect((await h.call('GET', '/system/status')).statusCode).toBe(404); // not built yet (M3.5), but not 503
  });

  test('a database from a newer MileWage is refused before anything is written', async () => {
    await h.signUp();
    h.db.prepare("INSERT INTO schema_migrations VALUES ('core', '9999_from_the_future', 1)").run();
    await expect(upgrade(bundled())).rejects.toBeInstanceOf(MigrationError);
    expect(preMigrationFiles()).toEqual([]);
    expect(h.state.mode).toBe('normal');
  });

  test('a brand-new database migrates without a backup (nothing to protect)', async () => {
    const path = join(h.dir, 'new.db');
    const db = openDatabase(path);
    const backup = buildBackupService({
      db,
      now: () => 1,
      backupDir: join(h.dir, 'nb'),
      configDir: join(h.dir, 'no-config'),
    });
    const state = createServerState();
    await upgradeDatabase({ db, backup, state, migrations: bundled() });
    expect(state.migration.status).toBe('applied');
    expect(state.migration.backup).toBeNull();
    expect(existsSync(join(h.dir, 'nb'))).toBe(false);
    db.close();
  });

  test('an upgrade from an older schema keeps data: the 0006 column is added with data in place', async () => {
    const path = join(h.dir, 'old.db');
    const old = openDatabase(path);
    migrate(
      old,
      bundled().filter((m) => !m.id.startsWith('0006')),
    );
    old.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
      INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at) VALUES (1,'US','mi','USD','UTC',1);
      INSERT INTO instance (id, instance_id) VALUES (1, 'old');`);
    fileSecrets(join(h.dir, 'config')).write({
      age_public_key: (await generateRecoveryKey()).recipient,
    });
    const state = createServerState();
    const backup = buildBackupService({
      db: old,
      now: () => 5,
      backupDir: join(h.dir, 'ob'),
      configDir: join(h.dir, 'config'),
    });
    await upgradeDatabase({ db: old, backup, state, migrations: bundled() });
    expect(state.migration).toMatchObject({
      status: 'applied',
      pending: ['core/0006_setup_confirmation'],
    });
    expect(old.prepare('SELECT instance_id, setup_confirmed_at FROM instance').get()).toEqual({
      instance_id: 'old',
      setup_confirmed_at: 0,
    });
    expect(readdirSync(join(h.dir, 'ob', 'pre-migration'))).toHaveLength(1);
    old.close();
  });
});
