import type { Db } from './open';

export type ChangeEntity = 'shift' | 'trip' | 'odometer' | 'vehicle' | 'settings' | 'override';
export interface ChangeRow {
  seq: number;
  userId: number;
  entity: ChangeEntity;
  key: string;
  op: 'upsert' | 'delete';
  at: number;
}

/** The pull path's two tables (07 section 2.7). Written only while the `sync` module is on. */
export function createSyncRepository(db: Db) {
  const insert = db.prepare(
    'INSERT INTO change_log (user_id, entity, key, op, at) VALUES (?, ?, ?, ?, ?)',
  );
  const page = db.prepare(
    `SELECT seq, user_id AS userId, entity, key, op, at FROM change_log
      WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
  );
  const minSeq = db.prepare('SELECT min(seq) FROM change_log WHERE user_id = ?').pluck();
  const counter = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'").pluck();
  return {
    record: (userId: number, entity: ChangeEntity, key: string, op: ChangeRow['op'], at: number) =>
      void insert.run(userId, entity, key, op, at),
    after: (userId: number, after: number, limit: number): ChangeRow[] =>
      page.all(userId, after, limit) as ChangeRow[],
    /**
     * A cursor is stale when rows after it were pruned (30 days) or when it is ahead of the log, which
     * is what a restore from an older backup looks like (08 section 6a, 10 section 7).
     */
    expired(userId: number, after: number): boolean {
      if (after === 0) return false;
      const last = (counter.get() as number | undefined) ?? 0;
      if (after > last) return true;
      const first = minSeq.get(userId) as number | null;
      return first === null ? after < last : after < first - 1;
    },
    /** Trip keys of a shift whose latest entry in the log is an upsert (what the phone may still hold). */
    liveTripKeys(userId: number, shiftClientId: string): string[] {
      return (
        db
          .prepare(
            `SELECT key FROM change_log c
              WHERE user_id = ? AND entity = 'trip' AND substr(key, 1, ?) = ?
                AND seq = (SELECT max(seq) FROM change_log WHERE entity = 'trip' AND key = c.key)
                AND op = 'upsert'`,
          )
          .all(userId, shiftClientId.length + 1, `${shiftClientId}:`) as { key: string }[]
      ).map((r) => r.key);
    },
    overwrite: (
      userId: number,
      at: number,
      entity: string,
      key: string,
      supersededJson: string,
      deviceId: number | null,
    ) =>
      void db
        .prepare(
          'INSERT INTO overwrite_log (user_id, at, entity, key, superseded_json, by_device_id) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(userId, at, entity, key, supersededJson, deviceId),
    prune: (before: number): number =>
      db.prepare('DELETE FROM change_log WHERE at < ?').run(before).changes,
  };
}
