import { fileURLToPath } from 'node:url';
import { loadMigrations, migrate, type MigrateOptions } from './migrate';
import { openDatabase, type Db } from './open';

export * from './backup-repository';
export * from './migrate';
export * from './open';
export * from './processing-repository';
export * from './repositories';
export * from './schema';
export * from './shift-repository';
export * from './telemetry-repository';
export * from './upgrade';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export function openAndMigrate(path: string, opts: MigrateOptions = {}): Db {
  const db = openDatabase(path);
  try {
    migrate(db, loadMigrations(MIGRATIONS_DIR), { lockPath: `${path}.migrate.lock`, ...opts });
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
