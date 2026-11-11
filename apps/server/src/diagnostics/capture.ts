import type { Db } from '../db';

/** Capture data cap (16 section 7.2): 200 MB in total. */
export const CAPTURE_CAP_BYTES = 200 * 1024 * 1024;
/** Estimated size of one stored fix with its row overhead. */
export const FIX_BYTES = 48;
const DAY = 24 * 3600_000;

export interface SessionRow {
  id: number;
  userId: number;
  deviceId: number;
  profile: 'dense';
  createdAt: number;
  expiresAt: number;
  endedAt: number | null;
  maxShifts: number;
}
export interface Annotation {
  clientId: string;
  at: number;
  kind: 'real_stop' | 'false_stop' | 'missed_stop' | 'event' | 'note';
  shift: string | null;
  stopKey: string | null;
  text: string | null;
}
export interface FixRow {
  seq: number;
  shift: string;
  t: number;
  latE7: number;
  lonE7: number;
  accuracyM: number;
  speedDmps: number | null;
  bearingDeg: number | null;
  altitudeM: number | null;
}

/** The capture tables inside diagnostics.db (module `capture`). */
export function createCaptureStore(db: Db) {
  const session = (id: number) =>
    db
      .prepare(
        `SELECT id, user_id AS userId, device_id AS deviceId, profile, created_at AS createdAt,
                expires_at AS expiresAt, ended_at AS endedAt, max_shifts AS maxShifts
           FROM capture_sessions WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;
  const scalar = (sql: string, ...args: unknown[]) =>
    db
      .prepare(sql)
      .pluck()
      .get(...args) as number;
  return {
    session,
    sessions: (userId: number) =>
      db
        .prepare(
          `SELECT id, user_id AS userId, device_id AS deviceId, profile, created_at AS createdAt,
                  expires_at AS expiresAt, ended_at AS endedAt, max_shifts AS maxShifts
             FROM capture_sessions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as SessionRow[],
    insert: (s: Omit<SessionRow, 'id' | 'endedAt'>) =>
      Number(
        db
          .prepare(
            'INSERT INTO capture_sessions (user_id, device_id, profile, created_at, expires_at, max_shifts) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(s.userId, s.deviceId, s.profile, s.createdAt, s.expiresAt, s.maxShifts)
          .lastInsertRowid,
      ),
    end: (id: number, at: number) =>
      void db
        .prepare('UPDATE capture_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
        .run(at, id),
    remove: (id: number) =>
      db.transaction(() => {
        for (const t of ['capture_fixes', 'capture_annotations'])
          db.prepare(`DELETE FROM ${t} WHERE capture_id = ?`).run(id);
        db.prepare('DELETE FROM capture_sessions WHERE id = ?').run(id);
      })(),
    fixCount: (id: number) => scalar('SELECT count(*) FROM capture_fixes WHERE capture_id = ?', id),
    shiftsDone: (id: number) =>
      scalar('SELECT count(DISTINCT shift_client_id) FROM capture_fixes WHERE capture_id = ?', id),
    hasShift: (id: number, shift: string) =>
      db
        .prepare('SELECT 1 FROM capture_fixes WHERE capture_id = ? AND shift_client_id = ? LIMIT 1')
        .get(id, shift) !== undefined,
    activeFor: (deviceId: number, now: number) =>
      db
        .prepare(
          `SELECT id FROM capture_sessions WHERE device_id = ? AND ended_at IS NULL AND expires_at > ? ORDER BY id DESC`,
        )
        .pluck()
        .all(deviceId, now) as number[],
    totalBytes: () =>
      scalar('SELECT count(*) FROM capture_fixes') * FIX_BYTES +
      scalar('SELECT coalesce(sum(length(text) + 80), 0) FROM capture_annotations'),
    insertFixes(id: number, shift: string, fixes: readonly Omit<FixRow, 'shift'>[]): number {
      const put = db.prepare(
        `INSERT OR IGNORE INTO capture_fixes (capture_id, seq, shift_client_id, recorded_at, lat_e7, lon_e7, accuracy_m, speed_dmps, bearing_deg, altitude_m)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      return db.transaction(() => {
        let n = 0;
        for (const f of fixes)
          n += put.run(
            id,
            f.seq,
            shift,
            f.t,
            f.latE7,
            f.lonE7,
            f.accuracyM,
            f.speedDmps,
            f.bearingDeg,
            f.altitudeM,
          ).changes;
        return n;
      })();
    },
    fixes: (id: number) =>
      db
        .prepare(
          `SELECT seq, shift_client_id AS shift, recorded_at AS t, lat_e7 AS latE7, lon_e7 AS lonE7, accuracy_m AS accuracyM,
                  speed_dmps AS speedDmps, bearing_deg AS bearingDeg, altitude_m AS altitudeM
             FROM capture_fixes WHERE capture_id = ? ORDER BY recorded_at, seq`,
        )
        .all(id) as FixRow[],
    putAnnotation: (id: number, a: Annotation) =>
      void db
        .prepare(
          `INSERT OR REPLACE INTO capture_annotations (capture_id, client_id, at, kind, shift_client_id, stop_key, text)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, a.clientId, a.at, a.kind, a.shift, a.stopKey, a.text),
    deleteAnnotation: (id: number, clientId: string) =>
      db
        .prepare('DELETE FROM capture_annotations WHERE capture_id = ? AND client_id = ?')
        .run(id, clientId).changes > 0,
    annotations: (id: number) =>
      db
        .prepare(
          `SELECT client_id AS clientId, at, kind, shift_client_id AS shift, stop_key AS stopKey, text
             FROM capture_annotations WHERE capture_id = ? ORDER BY at, client_id`,
        )
        .all(id) as Annotation[],
    /** Capture data goes 30 days after its session ended or expired (16 section 7.2). */
    purge(now: number): number[] {
      const ids = db
        .prepare(`SELECT id FROM capture_sessions WHERE coalesce(ended_at, expires_at) < ?`)
        .pluck()
        .all(now - 30 * DAY) as number[];
      for (const id of ids) this.remove(id);
      return ids;
    },
  };
}
export type CaptureStore = ReturnType<typeof createCaptureStore>;

/**
 * The state of a session at `now`: active, ended by the owner, or expired by time. The shift limit does not end a session:
 * it only refuses fixes of a further shift (see the upload route).
 */
export function stateOf(s: SessionRow, now: number): 'active' | 'ended' | 'expired' {
  if (s.endedAt !== null) return 'ended';
  return s.expiresAt <= now ? 'expired' : 'active';
}

/**
 * Anonymized replay coordinates (16 section 8.4): metres east and north of the first fix in an equirectangular
 * projection at that latitude, re-embedded at latitude 0, longitude 0 (where a degree is the same length both ways on
 * the engine's sphere). Distances and shapes survive; the place does not.
 */
export function anonymizer(first: { latE7: number; lonE7: number }) {
  const cos = Math.cos((first.latE7 / 1e7) * (Math.PI / 180));
  return (p: { latE7: number; lonE7: number }) => ({
    latE7: p.latE7 - first.latE7,
    lonE7: Math.round((p.lonE7 - first.lonE7) * cos),
  });
}
