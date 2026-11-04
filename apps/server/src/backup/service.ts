import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createBackupRepository, type BackupRunRow, type Db } from '../db';
import {
  createBackupEngine,
  type BackupEngine,
  type BackupEngineOptions,
  type BackupTrigger,
} from './engine';
import { RETENTION, selectExcess, selectExpired } from './retention';

export interface BackupServiceOptions {
  db: Db;
  dir: string;
  now: () => number;
  /** The instance's IANA time zone, for the retention calendar. */
  timeZone: () => string;
  /** False until setup is confirmed; nightly and shift-end runs wait, other triggers do not. */
  ready?: () => boolean;
  /** See BackupEngineOptions.codec. */
  codec: BackupEngineOptions['codec'];
}

/**
 * The one service function the nightly job, the web button, setup, migrations and restore call
 * (10 section 3.1 "Modularity"). Single flight: a second request while one runs gets the same run.
 */
export function createBackupService(o: BackupServiceOptions) {
  const repo = createBackupRepository(o.db);
  const engine: BackupEngine = createBackupEngine(o);
  let inFlight: Promise<BackupRunRow | undefined> | undefined;
  let lastFailure: { at: number; message: string } | undefined;

  /** Pruning runs only after a backup verified clean (10 section 5). */
  function prune(trigger: BackupTrigger) {
    const remove = (names: string[], subdir?: string) => {
      for (const n of names) rmSync(join(o.dir, subdir ?? '', n), { force: true });
      repo.deleteByFile(names.map((n) => (subdir ? `${subdir}/${n}` : n)));
    };
    if (trigger === 'pre_migration') {
      remove(selectExcess(engine.files('pre-migration'), RETENTION.preMigration), 'pre-migration');
    } else if (trigger === 'pre_restore') {
      remove(selectExcess(engine.files('pre-restore'), RETENTION.preRestore), 'pre-restore');
    } else {
      remove(selectExpired(engine.files(), o.timeZone()));
    }
  }

  async function execute(trigger: BackupTrigger): Promise<BackupRunRow | undefined> {
    const userId = repo.ownerId();
    if (userId === undefined) return undefined; // nothing to protect before the owner exists
    if ((trigger === 'nightly' || trigger === 'shift_end') && o.ready?.() === false)
      return undefined;
    try {
      const a = await engine.run(trigger);
      const row = repo.insert({
        userId,
        createdAt: a.createdAt,
        trigger,
        fileName: a.fileName,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        integrityOk: 1,
      });
      prune(trigger);
      lastFailure = undefined;
      return row;
    } catch (e) {
      lastFailure = { at: o.now(), message: (e as Error).message };
      throw e;
    }
  }

  return {
    engine,
    timeZone: o.timeZone,
    cleanTemp: () => engine.cleanTemp(),
    /** Undefined when there is no owner yet. Rejects with BackupError; older backups are never deleted then. */
    run(trigger: BackupTrigger): Promise<BackupRunRow | undefined> {
      inFlight ??= execute(trigger).finally(() => (inFlight = undefined));
      return inFlight;
    },
    list: () => repo.list(),
    lastFailure: () => lastFailure,
    /** Creation time of the newest run in the given triggers; used for the 15-minute limit. */
    lastRunAt: (triggers: readonly BackupTrigger[]) =>
      repo.list().find((r) => triggers.includes(r.trigger))?.createdAt,
  };
}
export type BackupService = ReturnType<typeof createBackupService>;
