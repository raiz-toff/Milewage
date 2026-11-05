import type { SqlDb } from '../storage/sqliteStore';
import { MIGRATIONS, type Migration } from './schema';

export type SqlValue = string | number | null;

/** The slice of an `expo-sqlite` database `app.db` uses (a superset of the key-value one). */
export interface AppSqlDb extends SqlDb {
  runAsync(
    sql: string,
    ...params: SqlValue[]
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  /** Runs `task` in one transaction (rolled back if it throws). Tasks must not nest. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export class MigrationError extends Error {
  constructor(
    readonly reason: 'newer_than_app' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrateOptions {
  migrations?: Migration[];
  /**
   * Called before the first pending migration when the database holds rows that are not on the
   * server yet (15 section 11: copy `app.db` and `tracker.db` to `pre-migration/`). If it throws,
   * nothing is migrated.
   */
  beforeMigrate?: (info: { from: number; to: number }) => Promise<void>;
}

/** Rows that exist only on this phone: the reason for a pre-migration copy. */
export async function hasUnsyncedRows(db: AppSqlDb): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM shifts WHERE sync_state <> 'on_server')
          + (SELECT COUNT(*) FROM outbox WHERE status <> 'done') AS n`,
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Brings `app.db` to the newest schema. Each migration runs in its own transaction together with
 * its `user_version` bump, so a failure leaves the previous version intact and nothing is
 * discarded (15 section 11). A database newer than this app is refused, never guessed at.
 */
export async function migrate(db: AppSqlDb, opts: MigrateOptions = {}): Promise<number> {
  const list = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  const latest = list[list.length - 1]?.version ?? 0;
  const current =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (current > latest) {
    throw new MigrationError(
      'newer_than_app',
      `app.db is version ${current}; this app only knows version ${latest}`,
    );
  }
  const pending = list.filter((m) => m.version > current);
  if (pending.length === 0) return current;
  if (current > 0 && (await hasUnsyncedRows(db))) {
    await opts.beforeMigrate?.({ from: current, to: latest });
  }
  for (const m of pending) {
    try {
      await db.withTransactionAsync(async () => {
        await db.execAsync(m.sql);
        // `PRAGMA user_version` cannot take a bound parameter; the number is ours.
        await db.execAsync(`PRAGMA user_version = ${m.version}`);
      });
    } catch (e) {
      throw new MigrationError('failed', `migration ${m.version} failed: ${String(e)}`);
    }
  }
  return latest;
}

/** Opens the private `app.db` through `expo-sqlite`, loaded on first use, and migrates it. */
export async function openAppDb(
  open: () => Promise<AppSqlDb> = openExpoAppDb,
  opts: MigrateOptions = {},
): Promise<AppSqlDb> {
  const db = await open();
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');
  await migrate(db, opts);
  return db;
}

export function openExpoAppDb(name = 'milewage-app.db'): Promise<AppSqlDb> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('expo-sqlite') as typeof import('expo-sqlite');
  return sqlite.openDatabaseAsync(name) as unknown as Promise<AppSqlDb>;
}
