import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** `data/receipts/` next to the database file: on the volume, so the backup engine can reach it. */
export const receiptsDirOf = (db: { name: string }) => join(dirname(db.name), 'receipts');

const has = (db: Database.Database, table: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
  undefined;

/**
 * Copies the receipt files into the backup copy as `receipt_blobs`, so one encrypted file holds
 * everything and a restore brings the receipts back (18 section 5.4, 10). A row whose file is
 * missing on disk is left out; restore then reports it rather than inventing a file.
 */
export function embedReceipts(copyPath: string, dir: string): number {
  const copy = new Database(copyPath, { fileMustExist: true });
  try {
    if (!has(copy, 'expense_receipts')) return 0;
    const rows = copy.prepare('SELECT file, sha256 FROM expense_receipts').all() as {
      file: string;
      sha256: string;
    }[];
    if (rows.length === 0) return 0;
    copy.exec(
      'CREATE TABLE receipt_blobs (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes BLOB NOT NULL)',
    );
    const put = copy.prepare('INSERT INTO receipt_blobs (file, sha256, bytes) VALUES (?, ?, ?)');
    let n = 0;
    for (const r of rows) {
      const path = join(dir, r.file);
      if (!existsSync(path)) continue;
      put.run(r.file, r.sha256, readFileSync(path));
      n += 1;
    }
    return n;
  } finally {
    copy.close();
  }
}

/** Throws a message when an embedded file does not match the sha256 recorded for its receipt row. */
export function checkBlobs(restoredPath: string): void {
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true });
  try {
    if (!has(db, 'receipt_blobs')) return;
    const rows = db
      .prepare(
        `SELECT b.file, b.bytes, r.sha256 FROM receipt_blobs b LEFT JOIN expense_receipts r ON r.file = b.file`,
      )
      .all() as { file: string; bytes: Buffer; sha256: string | null }[];
    for (const r of rows) {
      const actual = createHash('sha256').update(r.bytes).digest('hex');
      if (r.sha256 === null || actual !== r.sha256) {
        throw new Error(`receipt ${r.file} does not match its recorded checksum`);
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Writes the embedded files into the receipts directory and removes files no receipt row of the
 * restored data refers to. Returns the receipt rows whose file the backup did not contain.
 */
export function extractReceipts(restoredPath: string, dir: string): string[] {
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true });
  try {
    const wanted = has(db, 'expense_receipts')
      ? (db.prepare('SELECT file FROM expense_receipts').pluck().all() as string[])
      : [];
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const blobs = has(db, 'receipt_blobs')
      ? (db.prepare('SELECT file, bytes FROM receipt_blobs').all() as {
          file: string;
          bytes: Buffer;
        }[])
      : [];
    for (const b of blobs) {
      writeFileSync(join(dir, `${b.file}.part`), b.bytes, { mode: 0o600 });
      renameSync(join(dir, `${b.file}.part`), join(dir, b.file));
    }
    const keep = new Set(wanted);
    for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f), { force: true });
    const have = new Set(blobs.map((b) => b.file));
    return wanted.filter((f) => !have.has(f) && !existsSync(join(dir, f)));
  } finally {
    db.close();
  }
}
