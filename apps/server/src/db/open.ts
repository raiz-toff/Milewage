import Database from 'better-sqlite3';

export type Db = Database.Database;

// 10 section 3.4: applied on every connection open. WAL is a property of the file; the rest are per connection.
export const PRAGMAS = {
  journal_mode: 'wal',
  synchronous: 1, // NORMAL
  foreign_keys: 1,
  busy_timeout: 5000,
  wal_autocheckpoint: 1000,
} as const;

/**
 * The WAL-reset bug (3.7.0 to 3.51.2) is fixed in 3.51.3, and backported to 3.50.7 and 3.44.6
 * (10 section 3.3). Any other series below 3.52 is unfixed.
 */
export function sqliteVersionOk(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (major !== 3) return major > 3;
  if (minor >= 52) return true;
  if (minor === 51) return patch >= 3;
  if (minor === 50) return patch >= 7;
  if (minor === 44) return patch >= 6;
  return false;
}

/** Opens the single write connection and applies the PRAGMAs, failing loudly if SQLite ignores one. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  const version = db.prepare('SELECT sqlite_version()').pluck().get() as string;
  if (!sqliteVersionOk(version)) {
    db.close();
    throw new Error(
      `Bundled SQLite ${version} has the WAL-reset bug; need 3.51.3, 3.50.7 or 3.44.6 or newer. Refusing to start (10 section 3.3).`,
    );
  }
  for (const [name, value] of Object.entries(PRAGMAS)) {
    db.pragma(`${name} = ${value}`);
    const got = db.pragma(name, { simple: true });
    if (String(got).toLowerCase() !== String(value)) {
      db.close();
      throw new Error(`SQLite did not accept PRAGMA ${name}=${value} (got ${String(got)}).`);
    }
  }
  return db;
}
