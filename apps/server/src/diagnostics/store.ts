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
  /** Events written since the store was opened (for `diag.self.writes_per_h`). */
  written(): number;
  /** Deletes events past `expires_at`, in transactions of at most `batch` rows; returns how many. */
  pruneExpired(now: number, batch?: number): number;
  /**
   * Keeps the live data under `maxBytes` (16 section 7.2): verbose rows first, then the oldest basic
   * rows except crashes; returns how many rows went.
   */
  enforceCap(maxBytes: number, batch?: number): number;
  /** Bytes of live pages (the file may stay larger until incremental vacuum has run). */
  liveBytes(): number;
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
    // Only takes effect on a new file; lets pruning give pages back to the disk (16 section 7.2).
    db.pragma('auto_vacuum = incremental');
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
  let writes = 0;
  // Size of the rows themselves (payload plus a fixed allowance for the row and its indexes). Pages are not
  // used: deleting scattered rows leaves half-empty pages that never come back, so the file size says little.
  const SZ = 'length(data) + length(kind) + 120';
  const liveBytes = () =>
    db.prepare(`SELECT coalesce(sum(${SZ}), 0) FROM diag_events`).pluck().get() as number;
  const deleteIds = (ids: number[], batch: number) => {
    const del = db.prepare('DELETE FROM diag_events WHERE id = ?');
    for (let i = 0; i < ids.length; i += batch) {
      db.transaction(() => ids.slice(i, i + batch).forEach((id) => del.run(id)))();
    }
  };
  /** Deletes up to `batch` expired rows per transaction until none are left. */
  const deleteExpired = (now: number, batch: number) => {
    const del = db.prepare(
      'DELETE FROM diag_events WHERE id IN (SELECT id FROM diag_events WHERE expires_at <= ? LIMIT ?)',
    );
    let total = 0;
    for (;;) {
      const n = db.transaction(() => del.run(now, batch).changes)();
      total += n;
      if (n < batch) return total;
    }
  };
  const vacuum = () => void db.pragma('incremental_vacuum');
  return {
    written: () => writes,
    liveBytes,
    pruneExpired(now, batch = 5000) {
      const n = deleteExpired(now, batch);
      if (n > 0) vacuum();
      return n;
    },
    enforceCap(maxBytes, batch = 5000) {
      let excess = liveBytes() - maxBytes;
      let removed = 0;
      for (const where of ["level = 'verbose'", "kind NOT IN ('crash')"]) {
        if (excess <= 0) break;
        const ids: number[] = [];
        let freed = 0;
        const pick = db.prepare(
          `SELECT id, ${SZ} AS sz FROM diag_events WHERE ${where} ORDER BY at, id`,
        );
        for (const r of pick.iterate() as Iterable<{ id: number; sz: number }>) {
          ids.push(r.id);
          freed += r.sz;
          if (freed >= excess) break;
        }
        deleteIds(ids, batch);
        excess -= freed;
        removed += ids.length;
      }
      if (removed > 0) vacuum();
      return removed;
    },
    insert: ({ userId, deviceId, receivedAt, event: e }) => (
      writes++,
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
      }).changes === 1
    ),
    count: () => db.prepare('SELECT count(*) FROM diag_events').pluck().get() as number,
    bytes: () => [path, `${path}-wal`].reduce((n, f) => n + fileSize(f), 0),
    close: () => void db.close(),
  };
}
