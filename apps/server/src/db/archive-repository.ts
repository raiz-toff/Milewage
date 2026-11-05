import type { Db } from './open';

export interface ArchiveRow {
  shiftId: number;
  geometry: string;
  rawPointCount: number;
  keptPointCount: number;
  toleranceM: number;
  archivedAt: number;
}
export interface PointRow {
  seq: number;
  t: number;
  latE7: number;
  lonE7: number;
}
export interface ArchiveCandidate {
  id: number;
  userId: number;
  status: 'ended' | 'finalized';
  endedAt: number;
  calcVersion: number | null;
}

/** The route archive and the raw points it replaces (07 sections 2.6 and 4.2). */
export function createArchiveRepository(db: Db) {
  const pointsOf = db.prepare(
    'SELECT seq, recorded_at AS t, lat_e7 AS latE7, lon_e7 AS lonE7 FROM telemetry_points WHERE shift_id = ? ORDER BY recorded_at, seq',
  );
  const archiveOf = (shiftId: number) =>
    db
      .prepare(
        `SELECT shift_id AS shiftId, geometry, raw_point_count AS rawPointCount,
                kept_point_count AS keptPointCount, tolerance_m AS toleranceM, archived_at AS archivedAt
           FROM route_archives WHERE shift_id = ?`,
      )
      .get(shiftId) as ArchiveRow | undefined;
  return {
    pointsOf: (shiftId: number) => pointsOf.all(shiftId) as PointRow[],
    archiveOf,
    hasArchive: (shiftId: number) =>
      db.prepare('SELECT 1 FROM route_archives WHERE shift_id = ?').get(shiftId) !== undefined,
    /** Ended or finalized shifts that still hold raw points, oldest first. */
    candidates: (): ArchiveCandidate[] =>
      db
        .prepare(
          `SELECT s.id, s.user_id AS userId, s.status, s.ended_at AS endedAt, s.calc_version AS calcVersion
             FROM shifts s
            WHERE s.status IN ('ended','finalized') AND s.ended_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM telemetry_points p WHERE p.shift_id = s.id)
            ORDER BY s.ended_at`,
        )
        .all() as ArchiveCandidate[],
    /**
     * Writes the archive row, checks it reads back with the expected counts, and only then deletes the
     * raw points: all in one transaction, so a failed check leaves the points where they are.
     */
    replacePoints(
      a: ArchiveRow & { userId: number },
      flag?: { code: string; detail: string },
    ): void {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO route_archives (shift_id, user_id, geometry, raw_point_count, kept_point_count, tolerance_m, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          a.shiftId,
          a.userId,
          a.geometry,
          a.rawPointCount,
          a.keptPointCount,
          a.toleranceM,
          a.archivedAt,
        );
        const back = archiveOf(a.shiftId);
        const vertices = back
          ? (JSON.parse(back.geometry) as { coordinates: unknown[] }).coordinates.length
          : -1;
        if (!back || vertices !== a.keptPointCount) throw new Error('archive did not read back');
        const gone = db.prepare('DELETE FROM telemetry_points WHERE shift_id = ?').run(a.shiftId);
        if (gone.changes !== a.rawPointCount)
          throw new Error('point count changed while archiving');
        if (flag) {
          db.prepare(
            "INSERT INTO shift_flags (user_id, shift_id, code, severity, detail, created_at) VALUES (?, ?, ?, 'info', ?, ?)",
          ).run(a.userId, a.shiftId, flag.code, flag.detail, a.archivedAt);
        }
      })();
    },
  };
}
