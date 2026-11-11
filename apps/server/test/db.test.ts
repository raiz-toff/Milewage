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
  sqliteVersionOk,
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

describe('SQLite version gate (10 section 3.3, B12)', () => {
  test('the fixed releases of each series pass, everything older is refused', () => {
    const ok = [
      '3.51.3',
      '3.51.9',
      '3.52.0',
      '3.53.4',
      '3.50.7',
      '3.50.9',
      '3.44.6',
      '3.44.9',
      '4.0.0',
    ];
    const bad = [
      '3.51.2',
      '3.51.0',
      '3.50.6',
      '3.44.5',
      '3.45.3',
      '3.49.1',
      '3.46.0',
      '3.40.1',
      '2.9.9',
    ];
    for (const v of ok) expect(sqliteVersionOk(v), v).toBe(true);
    for (const v of bad) expect(sqliteVersionOk(v), v).toBe(false);
  });

  test('the bundled SQLite passes, so the server opens a database', () => {
    const version = open().prepare('SELECT sqlite_version()').pluck().get() as string;
    expect(sqliteVersionOk(version), version).toBe(true);
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

  test('a 0.2.0 database loses the progress tables, inbox rows and streak switch on upgrade', () => {
    const db = open();
    const drop = 'progress/0002_drop_progress';
    migrate(
      db,
      real.filter((m) => `${m.module}/${m.id}` !== drop),
    );
    expect(tables(db)).toEqual(expect.arrayContaining(['badge_unlocks', 'progress_state']));
    const userId = createUserRepository(db).create({
      username: 'sam',
      passwordHash: 'x',
      createdAt: 1,
    }).id;
    const add = db.prepare(
      'INSERT INTO notifications (user_id, kind, dedupe_key, body_key, created_at) VALUES (?, ?, ?, ?, 0)',
    );
    add.run(userId, 'badge', 'badge:first_shift', 'badge');
    add.run(userId, 'goal_met', 'goal_met:1:2027-01-11', 'goal_met');
    db.prepare('INSERT INTO notification_prefs (user_id, goals, streak) VALUES (?, 0, 0)').run(
      userId,
    );
    expect(migrate(db, real)).toEqual([drop]);
    expect(tables(db)).not.toContain('badge_unlocks');
    expect(tables(db)).not.toContain('progress_state');
    expect(db.prepare('SELECT kind FROM notifications').pluck().all()).toEqual(['goal_met']);
    expect(db.prepare('SELECT * FROM notification_prefs').get()).toEqual({
      user_id: userId,
      goals: 0,
      tax_deadlines: 1,
      backup: 1,
      sync_reminder: 1,
    });
  });

  test('a 0.2.0 database loses the schedule tables, shift reminders and their switch on upgrade', () => {
    const db = open();
    const drop = 'schedule/0002_drop_schedule';
    migrate(
      db,
      real.filter((m) => `${m.module}/${m.id}` !== drop),
    );
    const planned = ['schedule_entries', 'schedule_off_days', 'schedule_templates'];
    expect(tables(db)).toEqual(expect.arrayContaining(planned));
    const userId = createUserRepository(db).create({
      username: 'sam',
      passwordHash: 'x',
      createdAt: 1,
    }).id;
    const templateId = db
      .prepare(
        "INSERT INTO schedule_templates (user_id, label, weekdays, start_time, end_time) VALUES (?, 'Evenings', 31, '17:00', '22:00')",
      )
      .run(userId).lastInsertRowid;
    db.prepare(
      "INSERT INTO schedule_entries (user_id, planned_on, start_time, end_time, template_id) VALUES (?, '2027-01-11', '17:00', '22:00', ?)",
    ).run(userId, templateId);
    db.prepare("INSERT INTO schedule_off_days (user_id, off_on) VALUES (?, '2027-01-12')").run(
      userId,
    );
    const add = db.prepare(
      'INSERT INTO notifications (user_id, kind, dedupe_key, body_key, created_at) VALUES (?, ?, ?, ?, 0)',
    );
    add.run(userId, 'shift_reminder', 'shift_reminder:1', 'shift_reminder');
    add.run(userId, 'goal_met', 'goal_met:1:2027-01-11', 'goal_met');
    db.prepare(
      'INSERT INTO notification_prefs (user_id, shift_reminders, goals) VALUES (?, 0, 0)',
    ).run(userId);
    expect(migrate(db, real)).toEqual([drop]);
    for (const t of planned) expect(tables(db)).not.toContain(t);
    expect(db.prepare('SELECT kind FROM notifications').pluck().all()).toEqual(['goal_met']);
    expect(db.prepare('SELECT * FROM notification_prefs').get()).toEqual({
      user_id: userId,
      goals: 0,
      tax_deadlines: 1,
      backup: 1,
      sync_reminder: 1,
    });
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
