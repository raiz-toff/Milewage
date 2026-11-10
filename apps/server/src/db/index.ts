import { fileURLToPath } from 'node:url';
import { loadMigrations, migrate, type MigrateOptions } from './migrate';
import { openDatabase, type Db } from './open';

export * from './archive-repository';
export * from './backup-repository';
export * from './earnings-repository';
export * from './expense-repository';
export * from './goal-repository';
export * from './migrate';
export * from './platform-repository';
export * from './open';
export * from './own-rate-repository';
export * from './place-repository';
export * from './processing-repository';
export * from './repositories';
export * from './schema';
export * from './shift-repository';
export * from './sync-repository';
export * from './tax-repository';
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
