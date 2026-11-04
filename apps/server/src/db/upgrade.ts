import type { BackupArtifact } from '../backup/engine';
import type { BackupService } from '../backup/service';
import type { ServerState } from '../state';
import { MigrationError, migrate, pendingMigrations, type Migration } from './migrate';
import type { Db } from './open';

export interface UpgradeOptions {
  db: Db;
  backup: BackupService;
  state: ServerState;
  /** The migrations to apply (the bundled ones; tests add extra or failing ones). */
  migrations: readonly Migration[];
  log?: (message: string, fields?: object) => void;
}

const hasData = (db: Db): boolean => {
  const users = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  return !!users && db.prepare('SELECT count(*) FROM users').pluck().get() !== 0;
};

/**
 * The upgrade flow of 10 section 10, run at start before the app serves anything:
 *   1. a database written by a newer MileWage is refused (MigrationError, the process does not start);
 *   2. with pending migrations and real data, a verified backup goes to `pre-migration/` first;
 *   3. if that backup fails, the migrations do NOT run: the old schema stays and the server comes up in
 *      read-only mode (every write is 503 `read_only_mode`) with the reason on the status page;
 *   4. the migrations run in one transaction, so a failing one leaves the old schema intact (same mode);
 *   5. on success the backup is recorded in `backup_runs` (the table may only exist after step 4).
 * The outcome is left in `state.migration`.
 */
export async function upgradeDatabase(o: UpgradeOptions): Promise<void> {
  const { db, state } = o;
  const pending = pendingMigrations(db, o.migrations); // throws for a newer database
  const ids = pending.map((m) => `${m.module}/${m.id}`);
  if (pending.length === 0)
    return void (state.migration = { status: 'none', pending: [], backup: null });

  state.migration = { status: 'running', pending: ids, backup: null };
  let artifact: BackupArtifact | undefined;
  if (hasData(db)) {
    try {
      artifact = await o.backup.engine.run('pre_migration');
      state.migration.backup = artifact.fileName;
    } catch (e) {
      const error = `The pre-migration backup failed: ${(e as Error).message}`;
      state.migration = { status: 'blocked', pending: ids, backup: null, error };
      state.set(
        'read_only',
        `Upgrade paused. ${error} No migration was applied; fix the cause and restart.`,
      );
      o.log?.('upgrade blocked', { error });
      return;
    }
  }
  try {
    migrate(db, o.migrations, { lockPath: `${db.name}.migrate.lock` });
  } catch (e) {
    const error =
      e instanceof MigrationError ? e.message : `Migration failed: ${(e as Error).message}`;
    state.migration = { status: 'failed', pending: ids, backup: artifact?.fileName ?? null, error };
    state.set(
      'read_only',
      `Upgrade failed and was rolled back; the data is unchanged. ${error} ` +
        (artifact ? `The backup taken before it is ${artifact.fileName}.` : ''),
    );
    o.log?.('upgrade failed', { error });
    return;
  }
  if (artifact) o.backup.record('pre_migration', artifact);
  state.migration = { status: 'applied', pending: ids, backup: artifact?.fileName ?? null };
  o.log?.('upgrade applied', { migrations: ids.length, backup: artifact?.fileName ?? null });
}
