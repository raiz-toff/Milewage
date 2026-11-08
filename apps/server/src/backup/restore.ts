import Database from 'better-sqlite3';
import { createReadStream, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createUserRepository, loadMigrations, migrate, MIGRATIONS_DIR, type Db } from '../db';
import { ProblemError } from '../errors';
import type { ServerState } from '../state';
import { decryptStream, recipientOf } from './age';
import { checkBlobs, extractReceipts } from '../receipts/store';
import type { SecretsStore } from './secrets';
import type { BackupService } from './service';

/** The verification output of 10 section 7 step 6 (`RestoreVerification` in 08, plus ids). */
export interface RestoreVerification {
  integrity_ok: boolean;
  schema_version: number;
  shift_count: number;
  stop_label_count: number;
  point_count: number;
  first_shift_at: number | null;
  last_shift_at: number | null;
  latest_shift_total_m: number | null;
  instance_id: string;
  restore_generation: number;
}

export interface RestoreOptions {
  db: Db;
  backup: BackupService;
  secrets: SecretsStore;
  state: ServerState;
  /** Where receipt files live; the files embedded in the backup are written back here. */
  receiptsDir?: string;
  /** Scratch space for the decrypted copy; default: next to the database file. */
  workDir?: string;
  /** Test seam: runs inside the swap transaction after the built-in checks; throw to force a revert. */
  verify?: (db: Db) => void;
  log?: (message: string, fields?: object) => void;
}

const bad = (path: string, message: string) =>
  new ProblemError('validation_failed', message, [{ path, message }]);

/** The message both restore paths give for a backup from a newer MileWage (10 section 7 step 1). */
export const NEWER_BACKUP = 'This backup was written by a newer MileWage. Update the server first.';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const count = (db: Db, table: string): number => {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return exists
    ? (db
        .prepare(`SELECT count(*) FROM ${quote(table)}`)
        .pluck()
        .get() as number)
    : 0;
};

/** Counts, date range, instance id and generation of the (now live) database. */
function verification(db: Db, integrityOk: boolean): RestoreVerification {
  const range = db
    .prepare('SELECT min(started_at) first, max(started_at) last FROM shifts')
    .get() as {
    first: number | null;
    last: number | null;
  };
  const latest = db
    .prepare('SELECT total_m FROM shifts ORDER BY started_at DESC, id DESC LIMIT 1')
    .get() as { total_m: number | null } | undefined;
  const inst = db
    .prepare('SELECT instance_id, restore_generation FROM instance WHERE id = 1')
    .get() as {
    instance_id: string;
    restore_generation: number;
  };
  return {
    integrity_ok: integrityOk,
    schema_version: count(db, 'schema_migrations'),
    shift_count: count(db, 'shifts'),
    stop_label_count: count(db, 'stop_labels'),
    point_count: count(db, 'telemetry_points'),
    first_shift_at: range.first,
    last_shift_at: range.last,
    latest_shift_total_m: latest?.total_m ?? null,
    instance_id: inst.instance_id,
    restore_generation: inst.restore_generation,
  };
}

/** The age recipient of a recovery key; a 422 for anything that is not one. */
export async function recoveryRecipient(recoveryKey: string): Promise<string> {
  try {
    return await recipientOf(recoveryKey);
  } catch {
    throw bad('/recovery_key', 'That is not an age recovery key.');
  }
}

/**
 * 10 section 7 step 1, shared by `POST /setup/restore` and `milewage-cli restore`: decrypts the
 * backup into `work/restored.db`, checks it, refuses one from a newer MileWage and brings an older
 * one to the current schema. Touches nothing live; returns the path of the verified copy.
 */
export async function prepareRestore(
  file: string,
  identity: string,
  work: string,
): Promise<string> {
  const restored = join(work, 'restored.db');
  try {
    const plain = await decryptStream(createReadStream(file), identity);
    await pipeline(plain, createGunzip(), createWriteStream(restored, { mode: 0o600 }));
  } catch {
    // Same answer for a wrong key and a damaged file: nothing more is revealed.
    throw bad('/recovery_key', 'The recovery key does not open this file, or the file is damaged.');
  }
  const copy = new Database(restored, { fileMustExist: true });
  try {
    const integrity = copy.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
      throw bad('/file', 'The backup failed its integrity check.');
    }
    if ((copy.pragma('foreign_key_check') as unknown[]).length > 0) {
      throw bad('/file', 'The backup failed its foreign key check.');
    }
    // Abort before anything is touched if it is from a newer MileWage (10 section 7 step 1).
    const known = new Set(loadMigrations(MIGRATIONS_DIR).map((m) => `${m.module}/${m.id}`));
    const has = copy.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get();
    const applied = has
      ? (copy.prepare('SELECT module, id FROM schema_migrations').all() as {
          module: string;
          id: string;
        }[])
      : [];
    if (applied.some((m) => !known.has(`${m.module}/${m.id}`))) {
      throw bad('/file', NEWER_BACKUP);
    }
    // An older backup is brought to the current schema in this scratch copy, so the live swap
    // below copies identical columns and the original backup file stays untouched.
    migrate(copy, loadMigrations(MIGRATIONS_DIR));
    copy.close();
    try {
      checkBlobs(restored); // each receipt file against its recorded sha256, before anything is touched
    } catch (e) {
      throw bad('/file', `The backup's receipts failed verification: ${(e as Error).message}.`);
    }
    return restored;
  } finally {
    copy.close();
  }
}

/**
 * 10 section 7 step 4: replaces every table's rows with the attached copy's, in one transaction, and
 * sets `restore_generation` past the live one, the restored one and `floorGeneration` (the CLI passes
 * the generation of the database it moved aside). Any failure rolls back.
 */
export function swapRestored(
  db: Db,
  restoredPath: string,
  opts: { floorGeneration?: number; verify?: (db: Db) => void } = {},
): RestoreVerification {
  const liveGeneration = Math.max(
    (db.prepare('SELECT restore_generation FROM instance WHERE id = 1').pluck().get() ??
      0) as number,
    opts.floorGeneration ?? 0,
  );
  db.pragma('foreign_keys = OFF'); // cannot change inside a transaction; FKs are checked explicitly below
  db.prepare('ATTACH DATABASE ? AS restored').run(restoredPath);
  try {
    return db.transaction(() => {
      const tables = (
        db
          .prepare(
            "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .pluck()
          .all() as string[]
      ).filter((t) =>
        db.prepare("SELECT 1 FROM restored.sqlite_master WHERE type = 'table' AND name = ?").get(t),
      );
      for (const t of tables) {
        const cols = (db.pragma(`main.table_info(${quote(t)})`) as { name: string }[])
          .map((c) => quote(c.name))
          .join(', ');
        db.exec(`DELETE FROM main.${quote(t)}`);
        db.exec(`INSERT INTO main.${quote(t)} (${cols}) SELECT ${cols} FROM restored.${quote(t)}`);
      }
      // The restored instance_id stays; the generation moves past BOTH counters (10 section 7 step 4).
      db.prepare(
        'UPDATE instance SET restore_generation = max(restore_generation, ?) + 1 WHERE id = 1',
      ).run(liveGeneration);
      if ((db.pragma('foreign_key_check') as unknown[]).length > 0) {
        throw new Error('foreign_key_check failed after the restore');
      }
      const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
        throw new Error('integrity_check failed after the restore');
      }
      opts.verify?.(db);
      return verification(db, true);
    })();
  } finally {
    db.exec('DETACH DATABASE restored');
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Restore (10 section 7), run inside the API process on the one write connection.
 *
 * Deviation from the spec's file swap, on purpose: closing and reopening the connection would
 * leave every repository holding a dead handle, so the verified, forward-migrated copy is attached
 * and its rows replace the live ones in ONE transaction. The "auto-revert" is then a rollback: any
 * failure (foreign keys, integrity, the injected `verify`) leaves the live database exactly as it was.
 */
export function createRestoreService(o: RestoreOptions) {
  const users = createUserRepository(o.db);
  const work = o.workDir ?? join(dirname(o.db.name), '.restore-tmp');

  return {
    /**
     * `file` is the uploaded `.db.gz.age`; `recoveryKey` is held in memory for this call only.
     * `allowExisting` is false for `POST /setup/restore` (fresh instance only).
     */
    async restore(
      file: string,
      recoveryKey: string,
      allowExisting: boolean,
    ): Promise<RestoreVerification> {
      if (!allowExisting && users.count() > 0) {
        throw new ProblemError(
          'setup_already_done',
          'This instance already has data. Use the command-line restore.',
        );
      }
      if (o.state.mode === 'restoring')
        throw new ProblemError('restoring', 'A restore is already running.');
      const recipient = await recoveryRecipient(recoveryKey);
      const prior = { mode: o.state.mode, reason: o.state.reason };
      o.state.set('restoring', 'restore in progress');
      try {
        rmSync(work, { recursive: true, force: true });
        mkdirSync(work, { recursive: true, mode: 0o700 });
        const restored = await prepareRestore(file, recoveryKey, work); // aborts here without touching live data
        // Safety copy of what is about to be replaced (10 section 7 step 3); skipped on a fresh host.
        const safety = await o.backup.run('pre_restore');
        o.log?.('restore safety copy', { file: safety?.fileName ?? null });
        let result: RestoreVerification;
        try {
          result = swapRestored(o.db, restored, { verify: o.verify });
        } catch (e) {
          // The transaction rolled back: the live database is as it was. Say so, do not leak details.
          o.log?.('restore reverted', { error: (e as Error).message });
          throw new ProblemError(
            'internal_error',
            'The restored data failed verification; nothing was changed.',
          );
        }
        if (o.receiptsDir) {
          const missing = extractReceipts(restored, o.receiptsDir);
          if (missing.length > 0)
            o.log?.('restore: receipt files not in the backup', { count: missing.length });
        }
        // A fresh host has no key yet: later backups must be readable with the card the driver holds.
        if (!o.secrets.read()?.age_public_key) o.secrets.write({ age_public_key: recipient });
        o.log?.('restore done', {
          shifts: result.shift_count,
          generation: result.restore_generation,
        });
        return result;
      } finally {
        rmSync(work, { recursive: true, force: true });
        o.state.set(prior.mode, prior.reason);
      }
    },
  };
}
export type RestoreService = ReturnType<typeof createRestoreService>;
