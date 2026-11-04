import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createUserRepository,
  loadMigrations,
  MIGRATIONS_DIR,
  migrate,
  MigrationError,
  openAndMigrate,
  openDatabase,
  startServer,
  type Db,
} from '../src/index';

let dir: string;
let dbs: Db[];
const open = (path = join(dir, 'milewage.db')) => {
  const db = openDatabase(path);
  dbs.push(db);
  return db;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-db-'));
  dbs = [];
});
afterEach(() => {
  dbs.forEach((d) => d.open && d.close());
  rmSync(dir, { recursive: true, force: true });
});

const tables = (db: Db) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

describe('PRAGMAs (10 section 3.4)', () => {
  test('applied on every open', () => {
    for (let i = 0; i < 2; i++) {
      const db = open();
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('synchronous', { simple: true })).toBe(1);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(db.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
      db.close();
    }
  });
});

describe('migration runner', () => {
  const real = loadMigrations(MIGRATIONS_DIR);

  test('first migration creates users, settings, instance; applying twice is idempotent', () => {
    const db = open();
    const seen: string[][] = [];
    const beforeMigrate = (p: readonly string[]) => void seen.push([...p]);
    expect(migrate(db, real, { beforeMigrate })).toEqual(real.map((m) => `${m.module}/${m.id}`));
    expect(migrate(db, real, { beforeMigrate })).toEqual([]);
    expect(seen).toEqual([real.map((m) => `${m.module}/${m.id}`)]);
    expect(tables(db)).toEqual(
      expect.arrayContaining(['users', 'settings', 'instance', 'schema_migrations']),
    );
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').pluck().get()).toBe(
      real.length,
    );
  });

  test('a failing migration leaves the old schema intact', () => {
    const db = open();
    migrate(db, real);
    const m = (id: string, sql: string) => ({ module: 'core', id, sql });
    const bad = [
      ...real,
      m('0002_ok', 'CREATE TABLE extra (id INTEGER)'),
      m('0003_bad', 'SELECT nope'),
    ];
    expect(() => migrate(db, bad)).toThrow(MigrationError);
    expect(tables(db)).not.toContain('extra');
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').pluck().get()).toBe(
      real.length,
    );
  });

  test('refuses a database newer than the code', () => {
    const path = join(dir, 'milewage.db');
    const db = open(path);
    migrate(db, [
      ...real,
      { module: 'core', id: '0002_future', sql: 'CREATE TABLE future (id INTEGER)' },
    ]);
    expect(() => migrate(db, real)).toThrow(/newer MileWage/);
    db.close();
    expect(() => openAndMigrate(path)).toThrow(/newer MileWage/);
  });

  test('a held lock blocks a second runner, and the lock is released afterwards', () => {
    const db = open();
    const lockPath = join(dir, 'm.lock');
    writeFileSync(lockPath, '1');
    expect(() => migrate(db, real, { lockPath })).toThrow(/Another migration is running/);
    rmSync(lockPath);
    migrate(db, real, { lockPath });
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('user repository', () => {
  test('count, create, findByUsername', () => {
    const db = openAndMigrate(join(dir, 'milewage.db'));
    dbs.push(db);
    const users = createUserRepository(db);
    const row = users.create({ username: 'sam', passwordHash: 'x', createdAt: 1 });
    expect(users.count()).toBe(1);
    expect(users.findByUsername('sam')).toEqual(row);
  });
});

describe('startServer', () => {
  const env = (extra = {}) => ({
    MILEWAGE_PORT: '0',
    MILEWAGE_HOST: '127.0.0.1',
    MILEWAGE_LOG_LEVEL: 'silent',
    MILEWAGE_CONFIG_DIR: join(dir, 'config'),
    MILEWAGE_DATA_DIR: join(dir, 'data'),
    ...extra,
  });

  test('migrates and serves health; refuses a database newer than the code', async () => {
    const app = await startServer(env());
    expect((await app.fastify.inject('/healthz')).json()).toEqual({ ok: true });
    expect(tables(app.db)).toContain('users');
    app.db.prepare("INSERT INTO schema_migrations VALUES ('core', '9999_future', 1)").run();
    await app.fastify.close();
    await expect(startServer(env())).rejects.toThrow(/newer MileWage/);
  });
});
