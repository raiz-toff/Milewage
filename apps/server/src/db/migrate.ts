import { closeSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './open';

export interface Migration {
  module: string;
  id: string;
  sql: string;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** Reads `<dir>/<module>/<NNNN_name>.sql`, ordered by module name then file name. Never edited after release. */
export function loadMigrations(dir: string): Migration[] {
  // Folders sorted here, not left to the file system: a migration may rely on an earlier folder's.
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((d) =>
      readdirSync(join(dir, d.name))
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => ({
          module: d.name,
          id: f.slice(0, -4),
          sql: readFileSync(join(dir, d.name, f), 'utf8'),
        })),
    );
}

export interface MigrateOptions {
  /** Pre-migration backup hook (10 section 3.1); a no-op until M3.4. */
  beforeMigrate?: (pending: readonly string[]) => void;
  lockPath?: string;
}

const REBUILD_MARK = /^-- migrate: foreign_keys=off\s*$/m;
const key = (m: { module: string; id: string }) => `${m.module}/${m.id}`;

/**
 * Migrations not yet applied, without writing anything. Throws MigrationError when the database
 * records a migration this code does not know (written by a newer MileWage).
 */
export function pendingMigrations(db: Db, migrations: readonly Migration[]): Migration[] {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get();
  const applied = has
    ? (db.prepare('SELECT module, id FROM schema_migrations').all() as Migration[])
    : [];
  const known = new Set(migrations.map(key));
  const unknown = applied.map(key).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new MigrationError(
      `This database was written by a newer MileWage (unknown migration ${unknown[0]}). Update the server instead of starting this version.`,
    );
  }
  const done = new Set(applied.map(key));
  return migrations.filter((m) => !done.has(key(m)));
}

/**
 * Forward-only runner. Refuses a database that records a migration this code does not know.
 * All pending migrations run in one transaction, so a failure leaves the old schema intact.
 * Returns the ids applied (empty when up to date).
 */
export function migrate(
  db: Db,
  migrations: readonly Migration[],
  opts: MigrateOptions = {},
): string[] {
  const release = acquireLock(opts.lockPath);
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, id TEXT NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (module, id))',
    );
    const pending = pendingMigrations(db, migrations);
    if (pending.length === 0) return [];
    opts.beforeMigrate?.(pending.map(key));
    const record = db.prepare(
      'INSERT INTO schema_migrations (module, id, applied_at) VALUES (?, ?, ?)',
    );
    // A migration that rebuilds a table other tables point at starts with `-- migrate: foreign_keys=off`.
    // SQLite ignores that PRAGMA inside a transaction, so it is set around the whole run and the
    // rows are re-checked before the commit.
    const rebuild = pending.some((m) => REBUILD_MARK.test(m.sql));
    if (rebuild) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        for (const m of pending) {
          db.exec(m.sql);
          record.run(m.module, m.id, Date.now());
        }
        if (rebuild && (db.pragma('foreign_key_check') as unknown[]).length > 0) {
          throw new Error('a table rebuild left rows that break a foreign key');
        }
      })();
    } catch (e) {
      throw new MigrationError(`Migration failed and was rolled back: ${(e as Error).message}`);
    } finally {
      if (rebuild) db.pragma('foreign_keys = ON');
    }
    return pending.map(key);
  } finally {
    release();
  }
}

function acquireLock(path: string | undefined): () => void {
  if (!path) return () => {};
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    throw new MigrationError(
      `Another migration is running (lock file ${path}). If no MileWage process is running, delete that file.`,
    );
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);
  return () => unlinkSync(path);
}
