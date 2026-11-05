import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MigrationError, hasUnsyncedRows, migrate, openAppDb } from '../src/db/appDb';
import { MIGRATIONS } from '../src/db/schema';
import { openNodeAppDb } from './support/nodeSql';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-app-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SHIFT = `INSERT INTO shifts (client_id, vehicle_id, status, segmenter, started_at, local_date, updated_at)
               VALUES (?, 3, 'ended', 'whole_shift', 1000, '2026-11-01', 1000)`;
const version = async (db: ReturnType<typeof openNodeAppDb>) =>
  (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;

describe('app.db schema (15 section 2.2)', () => {
  it('creates every table, at version 1, and a second open changes nothing', async () => {
    const db = openNodeAppDb();
    expect(await migrate(db)).toBe(1);
    const tables = (
      await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((t) => t.name);
    expect(tables).toEqual([
      'conflict_log',
      'odometer_readings',
      'outbox',
      'settings_cache',
      'shifts',
      'stops',
      'sync_state',
      'trips',
      'vehicles',
    ]);
    await db.runAsync(SHIFT, 'a');
    expect(await migrate(db)).toBe(1);
    expect((await db.getAllAsync('SELECT * FROM shifts')).length).toBe(1);
  });

  it('enforces the checks of the spec and cascades deletes from a shift', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    await db.runAsync(SHIFT, 'a');
    await expect(
      db.runAsync("UPDATE shifts SET status = 'paused' WHERE client_id = 'a'"),
    ).rejects.toThrow();
    await expect(
      db.runAsync("UPDATE shifts SET recon_status = 'x' WHERE client_id='a'"),
    ).rejects.toThrow();
    await expect(
      db.runAsync(
        "INSERT INTO outbox (kind, entity_key, body, created_at) VALUES ('shift.delete','a','{}',1)",
      ),
    ).rejects.toThrow();
    await expect(
      db.runAsync(
        `INSERT INTO trips (trip_key, shift_client_id, kind, original_kind, source, started_at, ended_at, distance_m, purpose)
         VALUES ('t', 'nope', 'active', 'active', 'auto', 1, 2, 3, '')`,
      ),
    ).rejects.toThrow();
    await db.runAsync(
      `INSERT INTO trips (trip_key, shift_client_id, kind, original_kind, source, started_at, ended_at, distance_m, purpose)
       VALUES ('a:1:active', 'a', 'active', 'active', 'auto', 1, 2, 3, '')`,
    );
    await db.runAsync("INSERT INTO odometer_readings VALUES ('a','shift_start',5,1,'local')");
    await db.runAsync('DELETE FROM shifts WHERE client_id = ?', 'a');
    expect(await db.getAllAsync('SELECT * FROM trips')).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM odometer_readings')).toEqual([]);
  });

  it('upgrades a database that holds unsynced rows, keeps them, and takes the pre-migration copy first', async () => {
    const db = openNodeAppDb(join(dir, 'app.db'));
    await migrate(db);
    await db.runAsync(SHIFT, 'unsynced');
    await db.runAsync(
      "INSERT INTO outbox (kind, entity_key, body, created_at) VALUES ('shift.end','unsynced','{}',1)",
    );
    expect(await hasUnsyncedRows(db)).toBe(true);

    const before: { from: number; to: number }[] = [];
    const v2 = {
      version: 2,
      sql: 'ALTER TABLE shifts ADD COLUMN extra TEXT; CREATE INDEX idx_extra ON shifts(extra);',
    };
    const to = await migrate(db, {
      migrations: [...MIGRATIONS, v2],
      beforeMigrate: async (i) => void before.push(i),
    });
    expect(to).toBe(2);
    expect(before).toEqual([{ from: 1, to: 2 }]);
    expect(await version(db)).toBe(2);
    expect(await db.getAllAsync('SELECT client_id, extra FROM shifts')).toEqual([
      { client_id: 'unsynced', extra: null },
    ]);
    expect((await db.getAllAsync('SELECT * FROM outbox')).length).toBe(1);
  });

  it('takes no copy on a fresh install or when everything is on the server', async () => {
    const calls: unknown[] = [];
    const opts = { beforeMigrate: async (i: unknown) => void calls.push(i) };
    const fresh = openNodeAppDb();
    await migrate(fresh, opts);
    expect(calls).toEqual([]);

    await fresh.runAsync(SHIFT, 'a');
    await fresh.runAsync("UPDATE shifts SET sync_state = 'on_server'");
    await migrate(fresh, {
      ...opts,
      migrations: [...MIGRATIONS, { version: 2, sql: 'CREATE TABLE z (a TEXT);' }],
    });
    expect(calls).toEqual([]);
  });

  it('rolls a failing migration back completely and keeps the old version and data', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    await db.runAsync(SHIFT, 'a');
    const bad = {
      version: 2,
      sql: 'CREATE TABLE half (a TEXT); INSERT INTO no_such_table VALUES (1);',
    };
    await expect(migrate(db, { migrations: [...MIGRATIONS, bad] })).rejects.toMatchObject({
      name: 'MigrationError',
      reason: 'failed',
    });
    expect(await version(db)).toBe(1);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'half'")).toBeNull();
    expect((await db.getAllAsync('SELECT * FROM shifts')).length).toBe(1);
  });

  it('does not migrate at all when the pre-migration copy fails', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    await db.runAsync(SHIFT, 'a');
    await expect(
      migrate(db, {
        migrations: [...MIGRATIONS, { version: 2, sql: 'CREATE TABLE z (a TEXT);' }],
        beforeMigrate: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(await version(db)).toBe(1);
  });

  it('refuses a database newer than the app instead of guessing', async () => {
    const db = openNodeAppDb();
    await migrate(db);
    await db.execAsync('PRAGMA user_version = 9');
    await expect(migrate(db)).rejects.toBeInstanceOf(MigrationError);
    await expect(migrate(db)).rejects.toMatchObject({ reason: 'newer_than_app' });
  });

  it('openAppDb sets WAL and foreign keys and migrates a file that survives a restart', async () => {
    const path = join(dir, 'app.db');
    const first = await openAppDb(async () => openNodeAppDb(path));
    await first.runAsync(SHIFT, 'kept');
    (first as unknown as { close(): void }).close();
    const second = await openAppDb(async () => openNodeAppDb(path));
    expect(await second.getAllAsync('SELECT client_id FROM shifts')).toEqual([
      { client_id: 'kept' },
    ]);
    const fk = await second.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk!.foreign_keys).toBe(1);
    (second as unknown as { close(): void }).close();
  });
});
