import type { KeyValueStore } from '../pairing/pairing';

/** The slice of an `expo-sqlite` database the store uses. */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL)';

/**
 * Durable plain storage: the active shift, the diagnostics ring, cached settings and permission
 * flags. One SQLite row per key, so each `set` is atomic (a kill mid-write leaves the old value
 * or the new one, never half of it). Not for secrets: the credential is in the Keystore store.
 */
export class SqliteKeyValueStore implements KeyValueStore {
  private ready: Promise<SqlDb> | null = null;

  constructor(private readonly open: () => Promise<SqlDb>) {}

  private db(): Promise<SqlDb> {
    this.ready ??= this.open().then(async (db) => {
      await db.execAsync('PRAGMA journal_mode = WAL');
      await db.execAsync(SCHEMA);
      return db;
    });
    // A failed open is retried on the next call instead of poisoning the store.
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    const row = await (
      await this.db()
    ).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', key);
    return row?.v ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await (
      await this.db()
    ).runAsync(
      'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      value,
    );
  }

  async remove(key: string): Promise<void> {
    await (await this.db()).runAsync('DELETE FROM kv WHERE k = ?', key);
  }
}

/** Opens the app's private database through `expo-sqlite`, loaded on first use. */
export function openExpoDb(name = 'milewage-kv.db'): Promise<SqlDb> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('expo-sqlite') as typeof import('expo-sqlite');
  return sqlite.openDatabaseAsync(name);
}
