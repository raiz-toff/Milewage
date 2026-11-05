import Database from 'better-sqlite3';
import { existsSync, renameSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DiagEvent } from '@milewage/shared';
import { loadMigrations, migrate, type Db } from '../db';

const MIGRATIONS_DIR = fileURLToPath(new URL('./diagnostics-migrations', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

export interface EventFilter {
  fromAt?: number;
  toAt?: number;
  kinds?: readonly string[];
  src?: string;
  deviceId?: number;
  shift?: string;
  level?: string;
  /** Keyset position of the last row of the previous page. */
  after?: { at: number; id: number };
  limit: number;
}
export interface EventRow {
  id: number;
  src: string;
  deviceId: number | null;
  seq: number | null;
  at: number;
  receivedAt: number;
  level: 'basic' | 'verbose';
  kind: string;
  shift: string | null;
  cap: number | null;
  v: string | null;
  data: Record<string, unknown>;
}

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
  /** Newest first by (at, id); returns up to `limit + 1` rows so the caller can tell whether more exist. */
  list(userId: number, f: EventFilter): EventRow[];
  /**
   * Rolls the raw events of every complete UTC day before `now`'s day into `diag_daily` (replacing earlier rows
   * of those days, so it is safe to repeat) and drops rollup rows older than 2 years. Returns rows written.
   */
  rollUp(now: number): number;
  /** The daily rollup rows, for tests and the trend views. */
  daily(): {
    day: string;
    device_id: number;
    metric: string;
    n: number;
    sum: number;
    max: number;
  }[];
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
    daily: () =>
      db
        .prepare(
          'SELECT day, device_id, metric, n, sum, max FROM diag_daily ORDER BY day, device_id, metric',
        )
        .all() as never,
    rollUp(now) {
      const today = new Date(now).toISOString().slice(0, 10);
      const rows = db
        .prepare(
          `SELECT date(at / 1000, 'unixepoch') AS day, coalesce(device_id, 0) AS dev, kind, data
             FROM diag_events
            WHERE kind IN ('engine.run','recon.result','server.sample','api.window','service.event','upload.window','track.window','shift.summary')
              AND date(at / 1000, 'unixepoch') < ?`,
        )
        .all(today) as { day: string; dev: number; kind: string; data: string }[];
      const acc = new Map<
        string,
        { day: string; dev: number; metric: string; n: number; sum: number; max: number }
      >();
      const add = (day: string, dev: number, metric: string, value: number, count = 1) => {
        const key = `${day}|${dev}|${metric}`;
        const a = acc.get(key) ?? { day, dev, metric, n: 0, sum: 0, max: -Infinity };
        a.n += count;
        a.sum += value;
        a.max = Math.max(a.max, value);
        acc.set(key, a);
      };
      for (const r of rows) {
        const d = JSON.parse(r.data) as Record<string, number | string>;
        const num = (k: string) => Number(d[k] ?? 0);
        switch (r.kind) {
          case 'engine.run':
            add(r.day, 0, 'engine_ms', num('ms'));
            break;
          case 'recon.result':
            add(r.day, 0, 'recon_diff_m', Math.abs(num('diff_m')));
            break;
          case 'server.sample':
            add(r.day, 0, 'rss_mb_max', num('rss_mb'));
            add(r.day, 0, 'lag_p95_ms_max', num('lag_p95_ms'));
            break;
          case 'api.window':
            add(r.day, 0, 'api_5xx', num('s5xx'));
            break;
          case 'service.event':
            if (d.event === 'restarted') add(r.day, r.dev, 'service_restarts', 1);
            break;
          case 'upload.window':
            add(
              r.day,
              r.dev,
              'upload_fail_pct',
              num('fail_net') +
                num('fail_4xx') +
                num('fail_5xx') +
                num('fail_429') +
                num('fail_507'),
              0,
            );
            add(r.day, r.dev, 'upload_fail_pct', 0, num('attempts'));
            break;
          case 'track.window':
            add(r.day, r.dev, 'fixes_per_h', num('fixes') * 6);
            break;
          case 'shift.summary':
            if (num('duration_s') > 0)
              add(
                r.day,
                r.dev,
                'battery_pct_per_h',
                ((num('battery_start') - num('battery_end')) / num('duration_s')) * 3600,
              );
            break;
        }
      }
      const days = [...new Set([...acc.values()].map((a) => a.day))];
      const put = db.prepare(
        'INSERT OR REPLACE INTO diag_daily (day, device_id, metric, n, sum, max) VALUES (?, ?, ?, ?, ?, ?)',
      );
      db.transaction(() => {
        for (const day of days) db.prepare('DELETE FROM diag_daily WHERE day = ?').run(day);
        for (const a of acc.values())
          put.run(a.day, a.dev, a.metric, a.n, a.sum, a.max === -Infinity ? 0 : a.max);
        const cutoff = new Date(now - 730 * 24 * 3600_000).toISOString().slice(0, 10);
        db.prepare('DELETE FROM diag_daily WHERE day < ?').run(cutoff);
      })();
      return acc.size;
    },
    list(userId, f) {
      const where = ['user_id = @userId'];
      const args: Record<string, unknown> = { userId, limit: f.limit + 1 };
      const add = (sql: string, key: string, value: unknown) => {
        if (value === undefined) return;
        where.push(sql);
        args[key] = value;
      };
      add('at >= @fromAt', 'fromAt', f.fromAt);
      add('at <= @toAt', 'toAt', f.toAt);
      add('src = @src', 'src', f.src);
      add('device_id = @deviceId', 'deviceId', f.deviceId);
      add('shift_client_id = @shift', 'shift', f.shift);
      add('level = @level', 'level', f.level);
      if (f.kinds && f.kinds.length > 0) {
        where.push(`kind IN (${f.kinds.map((_, i) => `@k${i}`).join(', ')})`);
        f.kinds.forEach((k, i) => (args[`k${i}`] = k));
      }
      if (f.after) {
        where.push('(at < @afterAt OR (at = @afterAt AND id < @afterId))');
        args.afterAt = f.after.at;
        args.afterId = f.after.id;
      }
      const rows = db
        .prepare(
          `SELECT id, src, device_id AS deviceId, seq, at, received_at AS receivedAt, level, kind,
                  shift_client_id AS shift, capture_id AS cap, app_v AS v, data
             FROM diag_events WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT @limit`,
        )
        .all(args) as (Omit<EventRow, 'data'> & { data: string })[];
      return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }));
    },
    bytes: () => [path, `${path}-wal`].reduce((n, f) => n + fileSize(f), 0),
    close: () => void db.close(),
  };
}
