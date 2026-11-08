import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stamp } from './backup/engine';
import {
  prepareRestore,
  recoveryRecipient,
  swapRestored,
  type RestoreVerification,
} from './backup/restore';
import { fileSecrets } from './backup/secrets';
import { openAndMigrate, type Db } from './db';
import { ProblemError } from './errors';
import { extractReceipts } from './receipts/store';

export interface RestoreIo {
  out(line: string): void;
  err(line: string): void;
  /** Asks one question on the terminal; absent when there is no terminal to ask on. */
  ask?(question: string): Promise<string>;
}

const STOP_API =
  'The database is in use: stop the api service first (docker compose stop api), then run this again.';
/** What a restore replaces. `diagnostics.db` is left alone, as `POST /setup/restore` does (10 section 2). */
const REPLACED = ['milewage.db', 'milewage.db-wal', 'milewage.db-shm', 'receipts'];

class Refused extends Error {}

/**
 * Whether another process has the database open, and its restore generation. The API keeps its
 * connection for its whole life, and a WAL connection holds a shared lock on the file, so taking
 * an exclusive lock fails while it runs. The OS drops the lock when a process dies, so a crashed
 * server never leaves a stale lock behind, and it works across containers on one volume.
 */
function liveGeneration(dbPath: string): number {
  if (existsSync(`${dbPath}.migrate.lock`)) throw new Refused(STOP_API);
  if (!existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { fileMustExist: true, timeout: 500 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    try {
      db.exec('BEGIN EXCLUSIVE');
    } catch {
      throw new Refused(STOP_API);
    }
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'instance'").get();
    const generation = has
      ? (db.prepare('SELECT restore_generation FROM instance WHERE id = 1').pluck().get() as
          number | undefined)
      : undefined;
    db.exec('COMMIT');
    return generation ?? 0;
  } finally {
    db.close();
  }
}

/** Renames, on the same volume, whichever of `names` exist; `to` is created only when one does. */
function moveAll(from: string, to: string, names: readonly string[]): void {
  const present = names.filter((n) => existsSync(join(from, n)));
  if (present.length > 0) mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const n of present) renameSync(join(from, n), join(to, n));
}

const day = (ms: number | null) => (ms === null ? '-' : new Date(ms).toISOString().slice(0, 10));

/**
 * `milewage-cli restore --file <backup> [--key <key> | --key @<file>] [--yes]` (10 section 7, run
 * with the API stopped). Decrypts and checks the backup with the same code as `POST /setup/restore`,
 * moves the current data into `<data>/before-restore-<time>/` (never deletes it), writes the restored
 * database and receipts and bumps `restore_generation` past both the old and the restored value, so
 * paired phones re-send what they hold (15 section 9.3). Returns 0, 1 (failed) or 2 (usage).
 */
export async function restoreCommand(
  opts: {
    file?: string;
    key?: string;
    yes: boolean;
    /** Test seam: runs inside the swap after the built-in checks; throw to force the revert. */
    verify?: (db: Db) => void;
  },
  env: Readonly<Record<string, string | undefined>>,
  io: RestoreIo,
): Promise<number> {
  if (!opts.file) {
    io.err('restore needs --file <path to the .db.gz.age backup>.');
    return 2;
  }
  if (!opts.yes && !io.ask) {
    io.err('Pass --yes to restore without a prompt.');
    return 2;
  }
  let key = opts.key ?? (await io.ask?.('Recovery key (AGE-SECRET-KEY-1...): '));
  if (!key) {
    io.err('restore needs the recovery key: --key <key>, --key @<file holding it>, or type it.');
    return 2;
  }
  const dataDir = env.MILEWAGE_DATA_DIR ?? '/app/data';
  const dbPath = join(dataDir, 'milewage.db');
  const work = join(dataDir, '.restore-tmp');
  if (!existsSync(opts.file)) {
    io.err(`No backup file at ${opts.file}.`);
    return 1;
  }
  try {
    if (key.startsWith('@')) {
      try {
        key = readFileSync(key.slice(1), 'utf8').trim();
      } catch {
        throw new Refused(`Cannot read the recovery key file ${key.slice(1)}.`);
      }
    }
    const recipient = await recoveryRecipient(key);
    liveGeneration(dbPath); // refuses early while the server runs
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true, mode: 0o700 }); // also creates the data folder on a fresh host
    const restored = await prepareRestore(opts.file, key, work); // nothing live is touched before this passes
    const aside = join(dataDir, `before-restore-${stamp(Date.now())}`);
    const found = new Database(restored, { readonly: true });
    const shifts = found.prepare('SELECT count(*) FROM shifts').pluck().get() as number;
    found.close();
    io.out(`The backup ${opts.file} opened and passed its checks (${shifts} shifts).`);
    io.out(
      existsSync(dbPath)
        ? `The data in ${dataDir} will be replaced by it. The current data is moved to ${aside}; nothing is deleted.`
        : `It will be written to ${dataDir}, which holds no data yet.`,
    );
    if (!opts.yes && (await io.ask!('Continue? Type yes: ')).trim().toLowerCase() !== 'yes') {
      io.err('Cancelled. Nothing was changed.');
      return 1;
    }
    const floor = liveGeneration(dbPath); // again: the server may have started during the prompt
    moveAll(dataDir, aside, REPLACED);
    let db: Db | undefined;
    let result: RestoreVerification;
    try {
      db = openAndMigrate(dbPath);
      result = swapRestored(db, restored, { floorGeneration: floor, verify: opts.verify });
      db.close();
    } catch (e) {
      // Auto-revert (10 section 7 step 5): the half-written new files go, the old data comes back.
      db?.close();
      for (const n of REPLACED) rmSync(join(dataDir, n), { recursive: true, force: true });
      moveAll(aside, dataDir, REPLACED);
      if (existsSync(aside)) rmdirSync(aside); // empty now; never a recursive delete of the old data
      throw new Refused(
        `The restored data failed verification (${(e as Error).message}); the previous data was put back.`,
      );
    }
    const missing = extractReceipts(restored, join(dataDir, 'receipts'));
    // As `POST /setup/restore`: with no key configured, later backups use the key just given.
    const secrets = fileSecrets(env.MILEWAGE_CONFIG_DIR ?? '/app/config');
    if (!secrets.read()?.age_public_key) secrets.write({ age_public_key: recipient });
    io.out(
      `Restored ${opts.file}: schema version ${result.schema_version}, integrity ${result.integrity_ok ? 'ok' : 'FAILED'}.`,
    );
    io.out(
      `${result.shift_count} shifts (${day(result.first_shift_at)} to ${day(result.last_shift_at)}), ${result.point_count} GPS points, ${result.stop_label_count} stop labels.`,
    );
    if (missing.length > 0) io.out(`${missing.length} receipt files were not in the backup.`);
    io.out(
      `Restore generation is now ${result.restore_generation}: paired phones re-send what they still hold.`,
    );
    io.out(
      existsSync(aside)
        ? `The previous data is in ${aside}. Delete that folder once you are satisfied.`
        : 'There was no previous data.',
    );
    io.out('Start the api service again (docker compose up -d).');
    return 0;
  } catch (e) {
    io.err(
      e instanceof Refused || e instanceof ProblemError
        ? e.message
        : `Restore failed: ${(e as Error).message}`,
    );
    return 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
