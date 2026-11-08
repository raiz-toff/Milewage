import { rmSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { join } from 'node:path';
import { createBackupRepository, type BackupRunRow, type Db } from '../db';
import {
  createBackupEngine,
  type BackupArtifact,
  type BackupEngine,
  type BackupEngineOptions,
  type BackupTrigger,
} from './engine';
import { RETENTION, selectExcess, selectExpired } from './retention';

/** What a finished run reports to listeners (the diagnostics `backup.run` event). */
export interface BackupFinished {
  trigger: BackupTrigger;
  ok: boolean;
  ms: number;
  bytes: number;
  /** Longest event-loop stall seen while the copy ran. */
  lagMaxMs: number;
}

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
  disk?: BackupEngineOptions['disk'];
  receiptsDir?: BackupEngineOptions['receiptsDir'];
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
  const listeners: ((r: BackupFinished) => void)[] = [];
  const announce = (r: BackupFinished) => {
    for (const l of listeners) {
      try {
        l(r);
      } catch {
        // a listener must never fail a backup
      }
    }
  };

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

  /** Writes the `backup_runs` row of a verified artifact, then prunes. */
  function record(trigger: BackupTrigger, userId: number, a: BackupArtifact): BackupRunRow {
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
    return row;
  }

  async function execute(trigger: BackupTrigger): Promise<BackupRunRow | undefined> {
    const userId = repo.ownerId();
    if (userId === undefined) return undefined; // nothing to protect before the owner exists
    if ((trigger === 'nightly' || trigger === 'shift_end') && o.ready?.() === false)
      return undefined;
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const started = Date.now();
    const finish = (ok: boolean, bytes: number) => {
      lag.disable();
      announce({
        trigger,
        ok,
        ms: Date.now() - started,
        bytes,
        lagMaxMs: Math.round(lag.max / 1e6),
      });
    };
    try {
      const row = record(trigger, userId, await engine.run(trigger));
      lastFailure = undefined;
      finish(true, row.sizeBytes);
      return row;
    } catch (e) {
      lastFailure = { at: o.now(), message: (e as Error).message };
      finish(false, 0);
      throw e;
    }
  }

  /** Undefined when there is no owner yet. Rejects with BackupError; older backups are never deleted then. */
  function run(trigger: BackupTrigger): Promise<BackupRunRow | undefined> {
    inFlight ??= execute(trigger).finally(() => (inFlight = undefined));
    return inFlight;
  }

  return {
    engine,
    /** Called after every run, verified or failed (one listener per interested module). */
    onFinished: (listener: (r: BackupFinished) => void) => void listeners.push(listener),
    /**
     * For the upgrade flow: the file is written before `backup_runs` may exist (old schema), so the
     * row is added afterwards with `record`.
     */
    record: (trigger: BackupTrigger, artifact: BackupArtifact) => {
      const userId = repo.ownerId();
      return userId === undefined ? undefined : record(trigger, userId, artifact);
    },
    timeZone: o.timeZone,
    /** Where a recorded backup lives on the `backups` volume. */
    pathOf: (row: BackupRunRow) => join(o.dir, row.fileName),
    cleanTemp: () => engine.cleanTemp(),
    run,
    /**
     * Like `run`, but never joins a run that started earlier: it waits for that one to end first.
     * For a change the next file must carry, such as a new recovery key.
     */
    runAfterCurrent(trigger: BackupTrigger): Promise<BackupRunRow | undefined> {
      const earlier = inFlight;
      if (!earlier) return run(trigger);
      return earlier.then(
        () => run(trigger),
        () => run(trigger),
      );
    },
    list: () => repo.list(),
    byId: (id: number) => repo.byId(id),
    lastFailure: () => lastFailure,
    /** Creation time of the newest run in the given triggers; used for the 15-minute limit. */
    lastRunAt: (triggers: readonly BackupTrigger[]) =>
      repo.list().find((r) => triggers.includes(r.trigger))?.createdAt,
  };
}
export type BackupService = ReturnType<typeof createBackupService>;
