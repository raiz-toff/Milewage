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
  const INBOX_DROP = 'zz_removed/0001_drop_notifications';

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
    // Up to before both drops; the inbox this test reads goes later (zz_removed/0001).
    const beforeInbox = real.filter((m) => `${m.module}/${m.id}` !== INBOX_DROP);
    migrate(
      db,
      beforeInbox.filter((m) => `${m.module}/${m.id}` !== drop),
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
    expect(migrate(db, beforeInbox)).toEqual([drop]);
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
    // Up to before both drops; the inbox this test reads goes later (zz_removed/0001).
    const beforeInbox = real.filter((m) => `${m.module}/${m.id}` !== INBOX_DROP);
    migrate(
      db,
      beforeInbox.filter((m) => `${m.module}/${m.id}` !== drop),
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
    expect(migrate(db, beforeInbox)).toEqual([drop]);
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

  test('a 0.2.0 database loses the assistant tokens, sign-in clients and audit log on upgrade', () => {
    const db = open();
    const drop = 'mcp/0005_drop_mcp';
    migrate(
      db,
      real.filter((m) => `${m.module}/${m.id}` !== drop),
    );
    const assistant = ['mcp_audit', 'mcp_clients', 'mcp_kept_off', 'mcp_tokens'];
    expect(tables(db)).toEqual(expect.arrayContaining(assistant));
    const userId = createUserRepository(db).create({
      username: 'sam',
      passwordHash: 'x',
      createdAt: 1,
    }).id;
    db.prepare(
      'INSERT INTO mcp_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, 0)',
    ).run('client-1', 'Claude Code', '["http://localhost:33418/callback"]');
    const tokenId = db
      .prepare(
        "INSERT INTO mcp_tokens (user_id, name, scope, token_hash, created_at, client_id, refresh_hash) VALUES (?, 'Claude Code', 'write', 'a', 0, 'client-1', 'b')",
      )
      .run(userId).lastInsertRowid;
    db.prepare(
      "INSERT INTO mcp_audit (user_id, token_id, at, tool, outcome, args) VALUES (?, ?, 0, 'add_expense', 'ok', '{}')",
    ).run(userId, tokenId);
    db.prepare('INSERT INTO mcp_kept_off (id, since) VALUES (1, 0)').run();
    expect(migrate(db, real)).toEqual([drop]);
    for (const t of assistant) expect(tables(db)).not.toContain(t);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'mcp_%'")
      .all();
    expect(indexes).toEqual([]);
    expect(createUserRepository(db).findByUsername('sam')?.id).toBe(userId);
  });

  test('the inbox drop runs after the progress and schedule drops that still write to the inbox', () => {
    const order = real.map((m) => `${m.module}/${m.id}`);
    const at = (k: string) => order.indexOf(k);
    expect(at(INBOX_DROP)).toBe(order.length - 1);
    expect(at('notifications/0001_notifications')).toBeLessThan(at('progress/0002_drop_progress'));
    expect(at('progress/0002_drop_progress')).toBeLessThan(at(INBOX_DROP));
    expect(at('schedule/0002_drop_schedule')).toBeLessThan(at(INBOX_DROP));
    // A 0.2.0 database: all three pending at once, in one run.
    const db = open();
    const later = ['progress/0002_drop_progress', 'schedule/0002_drop_schedule', INBOX_DROP];
    migrate(
      db,
      real.filter((m) => !later.includes(`${m.module}/${m.id}`)),
    );
    expect(migrate(db, real)).toEqual(later);
    expect(tables(db)).not.toContain('notifications');
  });

  test('a database from before the inbox drop loses the inbox and its switches on upgrade', () => {
    const db = open();
    migrate(
      db,
      real.filter((m) => `${m.module}/${m.id}` !== INBOX_DROP),
    );
    expect(tables(db)).toEqual(expect.arrayContaining(['notifications', 'notification_prefs']));
    const userId = createUserRepository(db).create({
      username: 'sam',
      passwordHash: 'x',
      createdAt: 1,
    }).id;
    const add = db.prepare(
      'INSERT INTO notifications (user_id, kind, dedupe_key, body_key, created_at, read_at) VALUES (?, ?, ?, ?, 0, ?)',
    );
    add.run(userId, 'goal_met', 'goal_met:1:2027-01-11', 'goal_met', null);
    add.run(userId, 'backup_failed', 'backup_failed:2027-01-12', 'backup_failed', 5);
    db.prepare(
      'INSERT INTO notification_prefs (user_id, goals, tax_deadlines, backup, sync_reminder) VALUES (?, 0, 1, 0, 1)',
    ).run(userId);
    expect(migrate(db, real)).toEqual([INBOX_DROP]);
    expect(tables(db)).not.toContain('notifications');
    expect(tables(db)).not.toContain('notification_prefs');
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_notif%'")
      .all();
    expect(indexes).toEqual([]);
    expect(createUserRepository(db).findByUsername('sam')?.id).toBe(userId);
    expect(migrate(db, real)).toEqual([]);
  });

  test('a 0.2.0 database turns place labels into the driver own labels, then loses places', () => {
    const db = open();
    const drop = 'stops/0003_drop_places';
    migrate(
      db,
      real.filter((m) => `${m.module}/${m.id}` !== drop),
    );
    const userId = createUserRepository(db).create({
      username: 'sam',
      passwordHash: 'x',
      createdAt: 1,
    }).id;
    db.exec(`
      INSERT INTO vehicles (id, user_id, name, kind, created_at) VALUES (7, ${userId}, 'Civic', 'car', 1);
      INSERT INTO shifts (id, user_id, client_id, vehicle_id, status, started_at, local_date, segmenter, updated_at, calculated_at) VALUES
        (1, ${userId}, 'a', 7, 'ended', 1, '2027-01-11', 'stops', 1, 500),
        (2, ${userId}, 'b', 7, 'finalized', 1, '2027-01-12', 'stops', 1, 600);
      INSERT INTO places (id, user_id, name, lat_e7, lon_e7, radius_m, role, created_at, updated_at) VALUES
        (1, ${userId}, 'Pizza Place', 0, 0, 100, 'dropoff', 1, 1),
        (2, ${userId}, 'Depot', 0, 0, 100, 'pickup', 1, 900);
      INSERT INTO stops (user_id, shift_id, stop_key, started_at, ended_at, dwell_s, lat_e7, lon_e7, confidence, est_role, role, place_id) VALUES
        (${userId}, 1, 'by-place', 1, 2, 300, 0, 0, 'high', 'pickup', 'dropoff', 1),
        (${userId}, 1, 'by-hand', 3, 4, 300, 0, 0, 'high', 'pickup', 'other', 1),
        (${userId}, 1, 'by-hand-named', 5, 6, 300, 0, 0, 'high', 'pickup', 'pickup', 1),
        (${userId}, 1, 'nowhere', 7, 8, 300, 0, 0, 'high', 'pickup', 'pickup', NULL),
        (${userId}, 2, 'place-changed-since', 1, 2, 300, 0, 0, 'high', 'none', 'dropoff', 2);
      INSERT INTO stop_labels (user_id, shift_id, stop_key, role, platform, place, edited_at) VALUES
        (${userId}, 1, 'by-hand', 'other', 'ubereats', NULL, 50),
        (${userId}, 1, 'by-hand-named', 'pickup', NULL, 'Back door', 60);
    `);
    expect(migrate(db, real)).toEqual([drop]);
    expect(tables(db)).not.toContain('places');
    expect(db.prepare("SELECT name FROM pragma_table_info('stops')").pluck().all()).not.toContain(
      'place_id',
    );
    expect(
      db
        .prepare(
          'SELECT shift_id, stop_key, role, platform, place, payout_cents, tip_cents, notes, edited_at FROM stop_labels ORDER BY shift_id, stop_key',
        )
        .all(),
    ).toEqual([
      // A hand label already won; it keeps its role and gets the name it was shown with.
      {
        shift_id: 1,
        stop_key: 'by-hand',
        role: 'other',
        platform: 'ubereats',
        place: 'Pizza Place',
        payout_cents: 0,
        tip_cents: 0,
        notes: null,
        edited_at: 50,
      },
      {
        shift_id: 1,
        stop_key: 'by-hand-named',
        role: 'pickup',
        platform: null,
        place: 'Back door',
        payout_cents: 0,
        tip_cents: 0,
        notes: null,
        edited_at: 60,
      },
      // A place label: the role the stop took in the last run, dated by that run.
      {
        shift_id: 1,
        stop_key: 'by-place',
        role: 'dropoff',
        platform: null,
        place: 'Pizza Place',
        payout_cents: 0,
        tip_cents: 0,
        notes: null,
        edited_at: 500,
      },
      // A finalized shift keeps what its run used, even when the place was changed later.
      {
        shift_id: 2,
        stop_key: 'place-changed-since',
        role: 'dropoff',
        platform: null,
        place: 'Depot',
        payout_cents: 0,
        tip_cents: 0,
        notes: null,
        edited_at: 600,
      },
    ]);
  });

  test('a 0.2.0 database loses the goals table and the goal setup step on upgrade', () => {
    const db = open();
    const removal = ['core/0015_setup_without_goal', 'goals/0002_drop_goals'];
    migrate(
      db,
      real.filter((m) => !removal.includes(`${m.module}/${m.id}`)),
    );
    expect(tables(db)).toContain('goals');
    const users = createUserRepository(db);
    const sam = users.create({ username: 'sam', passwordHash: 'x', createdAt: 1 }).id;
    const ana = users.create({ username: 'ana', passwordHash: 'x', createdAt: 1 }).id;
    const kim = users.create({ username: 'kim', passwordHash: 'x', createdAt: 1 }).id;
    db.prepare(
      "INSERT INTO goals (user_id, label, metric, period, target, created_at) VALUES (?, 'Weekly earnings', 'earnings', 'weekly', 80000, 0)",
    ).run(sam);
    const prefs = db.prepare(
      "INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at, setup_done) VALUES (?, 'CA', 'km', 'CAD', 'America/Toronto', 0, ?)",
    );
    prefs.run(sam, '["vehicle","goal","backup"]');
    prefs.run(ana, '["phone"]');
    prefs.run(kim, null);
    expect(migrate(db, real)).toEqual(removal);
    expect(tables(db)).not.toContain('goals');
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_goals%'")
      .all();
    expect(indexes).toEqual([]);
    const done = db.prepare('SELECT setup_done FROM settings ORDER BY user_id').pluck().all();
    expect(done).toEqual(['["vehicle","backup"]', '["phone"]', null]);
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
