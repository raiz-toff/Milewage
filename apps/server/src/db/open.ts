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

/** Opens the single write connection and applies the PRAGMAs, failing loudly if SQLite ignores one. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
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
