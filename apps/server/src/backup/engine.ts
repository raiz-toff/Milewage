import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Db } from '../db';

export type BackupTrigger = 'nightly' | 'shift_end' | 'manual' | 'pre_migration' | 'pre_restore';

export class BackupError extends Error {
  override name = 'BackupError';
  constructor(
    readonly reason: 'integrity' | 'foreign_keys' | 'counts' | 'io' | 'no_key',
    message: string,
  ) {
    super(message);
  }
}

/** The step after gzip: the age encryptor (`age.ts`). Tests may use `gzipOnly`. */
export interface BackupCodec {
  /** File name suffix after the timestamp, e.g. `.db.gz.age`. */
  suffix: string;
  wrap(gzipped: Readable): Promise<Readable> | Readable;
}
export const gzipOnly: BackupCodec = { suffix: '.db.gz', wrap: (s) => s };

export interface BackupArtifact {
  /** Path relative to the backup directory, e.g. `milewage-20261104T033000123Z.db.gz`. */
  fileName: string;
  sizeBytes: number;
  sha256: string;
  integrityOk: true;
  createdAt: number;
  /** Row counts of the verified copy. */
  counts: Record<string, number>;
}

export interface BackupEngineOptions {
  db: Db;
  /** The `backups` volume. */
  dir: string;
  now: () => number;
  /** Chosen per run, so a key added or removed later is honoured. Throws when no key is configured. */
  codec: () => BackupCodec | Promise<BackupCodec>;
}

// Tables compared live-vs-copy (10 section 3.1 step 3); telemetry differs by writes during the copy.
const COMPARED = ['shifts', 'stop_labels'];
/** Pages copied per event-loop turn, so the single writer is never starved for long. */
const PAGES_PER_STEP = 256;

const SUBDIR: Partial<Record<BackupTrigger, string>> = {
  pre_migration: 'pre-migration',
  pre_restore: 'pre-restore',
};

/** `20261104T033000123Z` */
export const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:.]/g, '');
export const BACKUP_FILE = /^milewage-(\d{8}T\d{9}Z)\.db\.gz(\.age)?$/;

function counts(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of [...COMPARED, 'telemetry_points']) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(t);
    if (exists) out[t] = db.prepare(`SELECT count(*) FROM ${t}`).pluck().get() as number;
  }
  return out;
}

/**
 * The backup procedure of 10 section 3.1 (steps 1-4). It runs on the one write connection: a second
 * writing connection would restart `db.backup()` (S0 finding, B5b). Recording in `backup_runs`
 * and retention are the service's job, not the engine's.
 */
export function createBackupEngine({ db, dir, now, codec: chooseCodec }: BackupEngineOptions) {
  const tmpDir = join(dir, '.tmp');
  const cleanTemp = () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  };

  /** Opens the copy read-only and applies every check; throws BackupError on the first failure. */
  function verifyCopy(path: string, start: Record<string, number>): Record<string, number> {
    const copy = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const integrity = copy.pragma('integrity_check') as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
        throw new BackupError('integrity', 'The backup copy failed PRAGMA integrity_check.');
      }
      if ((copy.pragma('foreign_key_check') as unknown[]).length > 0) {
        throw new BackupError('foreign_keys', 'The backup copy failed PRAGMA foreign_key_check.');
      }
      const got = counts(copy);
      for (const table of COMPARED) {
        if ((got[table] ?? 0) < (start[table] ?? 0)) {
          throw new BackupError(
            'counts',
            `The backup copy has fewer rows in ${table} than the live database.`,
          );
        }
      }
      return got;
    } finally {
      copy.close();
    }
  }

  return {
    /** Removes leftovers of an interrupted run; call once at start. */
    cleanTemp,

    async run(trigger: BackupTrigger): Promise<BackupArtifact> {
      const createdAt = now();
      const codec = await chooseCodec();
      const base = `milewage-${stamp(createdAt)}`;
      const subdir = SUBDIR[trigger];
      const targetDir = subdir ? join(dir, subdir) : dir;
      const tmpDb = join(tmpDir, `${base}.db`);
      const tmpOut = join(tmpDir, `${base}${codec.suffix}`);
      try {
        mkdirSync(tmpDir, { recursive: true });
        mkdirSync(targetDir, { recursive: true });
        const start = counts(db);
        await db.backup(tmpDb, { progress: () => PAGES_PER_STEP });
        const verified = verifyCopy(tmpDb, start);

        const hash = createHash('sha256');
        const digest = new Transform({
          transform(chunk, _enc, done) {
            hash.update(chunk as Buffer);
            done(null, chunk);
          },
        });
        const gz = new PassThrough();
        const gzipped = pipeline(createReadStream(tmpDb), createGzip(), gz);
        const sealed = await codec.wrap(gz);
        await Promise.all([
          gzipped,
          pipeline(sealed, digest, createWriteStream(tmpOut, { flags: 'wx', mode: 0o600 })),
        ]);
        const fileName = `${base}${codec.suffix}`;
        await rename(tmpOut, join(targetDir, fileName)); // atomic: a sync tool never sees a half file
        return {
          fileName: subdir ? `${subdir}/${fileName}` : fileName,
          sizeBytes: statSync(join(targetDir, fileName)).size,
          sha256: hash.digest('hex'),
          integrityOk: true,
          createdAt,
          counts: verified,
        };
      } catch (e) {
        if (e instanceof BackupError) throw e;
        throw new BackupError('io', `Backup failed: ${(e as Error).message}`);
      } finally {
        rmSync(tmpDb, { force: true });
        rmSync(tmpOut, { force: true });
        rmSync(`${tmpDb}-wal`, { force: true });
        rmSync(`${tmpDb}-shm`, { force: true });
      }
    },

    /** Backup files in `dir` (or a subfolder), newest first. */
    files(subdir?: string): string[] {
      const where = subdir ? join(dir, subdir) : dir;
      try {
        return readdirSync(where)
          .filter((f) => BACKUP_FILE.test(f))
          .sort()
          .reverse();
      } catch {
        return [];
      }
    },
  };
}
export type BackupEngine = ReturnType<typeof createBackupEngine>;
