import Database from 'better-sqlite3';
import { existsSync, renameSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DiagEvent } from '@milewage/shared';
import { loadMigrations, migrate, type Db } from '../db';

const MIGRATIONS_DIR = fileURLToPath(new URL('./diagnostics-migrations', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

export interface StoredEvent {
  userId: number;
  deviceId: number | null;
  receivedAt: number;
  event: DiagEvent;
}

/** The diagnostics store (16 section 7.1): its own file, its own single writer. */
export interface DiagnosticsStore {
  /** Inserts one event; returns false for a duplicate `(device, src, seq)`. */
  insert(e: StoredEvent): boolean;
  count(): number;
  /** Size of diagnostics.db plus its WAL. */
  bytes(): number;
  close(): void;
}

/** Raw-event retention (16 section 7.2): basic 90 days, verbose 14, `crash` 365. */
export function expiresAt(event: Pick<DiagEvent, 'kind' | 'level'>, receivedAt: number): number {
  if (event.kind === 'crash') return receivedAt + 365 * DAY;
  return receivedAt + (event.level === 'verbose' ? 14 : 90) * DAY;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function openAndMigrate(path: string): Db {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = wal');
    db.pragma('synchronous = 1');
    db.pragma('busy_timeout = 5000');
    const opts = path === ':memory:' ? {} : { lockPath: `${path}.migrate.lock` };
    migrate(db, loadMigrations(MIGRATIONS_DIR), opts);
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * Opens (creating if needed) diagnostics.db. A corrupt or newer-schema file is renamed aside and
 * recreated: diagnostics are disposable and must never stop the server (16 section 7.1, D15).
 */
export function openDiagnosticsStore(
  path: string,
  now: () => number = Date.now,
  onRecreated?: (movedTo: string, reason: string) => void,
): DiagnosticsStore {
  let db: Db;
  try {
    db = openAndMigrate(path);
  } catch (e) {
    if (path === ':memory:') throw e;
    const aside = `${path}.bad-${now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(path + suffix)) renameSync(path + suffix, aside + suffix);
    }
    onRecreated?.(aside, (e as Error).message);
    db = openAndMigrate(path);
  }
  const insert = db.prepare(
    `INSERT INTO diag_events (user_id, src, device_id, seq, at, received_at, level, kind, shift_client_id, capture_id, app_v, data, expires_at)
     VALUES (@userId, @src, @deviceId, @seq, @at, @receivedAt, @level, @kind, @shift, @cap, @v, @data, @expiresAt)
     ON CONFLICT DO NOTHING`,
  );
  return {
    insert: ({ userId, deviceId, receivedAt, event: e }) =>
      insert.run({
        userId,
        deviceId,
        receivedAt,
        src: e.src,
        seq: e.seq ?? null,
        at: e.at,
        level: e.level,
        kind: e.kind,
        shift: e.shift ?? null,
        cap: e.cap ?? null,
        v: e.v,
        data: JSON.stringify(e.data),
        expiresAt: expiresAt(e, receivedAt),
      }).changes === 1,
    count: () => db.prepare('SELECT count(*) FROM diag_events').pluck().get() as number,
    bytes: () => [path, `${path}-wal`].reduce((n, f) => n + fileSize(f), 0),
    close: () => void db.close(),
  };
}
