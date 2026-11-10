import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { places } from './schema';

/** A named place (ADR 0008): its centre in degrees x 1e7, its radius in whole metres, the label it gives. */
export type PlaceRow = typeof places.$inferSelect;
export type NewPlace = Pick<PlaceRow, 'name' | 'latE7' | 'lonE7' | 'radiusM' | 'role'>;

/** A stop of a shift that is not finalized or running, with where it is, for re-evaluating places. */
export interface StopPosition {
  shiftId: number;
  status: 'ended' | 'finalized';
  latE7: number;
  lonE7: number;
}

/** The driver's places, oldest first (the order that breaks a tie between two equally near places). */
export function createPlaceRepository(db: Db) {
  const orm = drizzle(db);
  const find = (userId: number, id: number): PlaceRow | undefined =>
    orm
      .select()
      .from(places)
      .where(and(eq(places.userId, userId), eq(places.id, id)))
      .get();
  return {
    list: (userId: number): PlaceRow[] =>
      orm.select().from(places).where(eq(places.userId, userId)).orderBy(asc(places.id)).all(),
    find,
    count: (userId: number): number =>
      db.prepare('SELECT count(*) FROM places WHERE user_id = ?').pluck().get(userId) as number,
    create: (userId: number, p: NewPlace, now: number): PlaceRow =>
      orm
        .insert(places)
        .values({ ...p, userId, createdAt: now, updatedAt: now })
        .returning()
        .get(),
    update: (userId: number, id: number, p: NewPlace, now: number): PlaceRow | undefined =>
      orm
        .update(places)
        .set({ ...p, updatedAt: now })
        .where(and(eq(places.userId, userId), eq(places.id, id)))
        .returning()
        .get(),
    delete: (userId: number, id: number) =>
      void orm
        .delete(places)
        .where(and(eq(places.userId, userId), eq(places.id, id)))
        .run(),
    /**
     * Stops of shifts recorded with stop detection, ended or finalized, inside a box of degrees x 1e7
     * (a cheap first cut; the caller measures the real distance).
     */
    stopsInBox(
      userId: number,
      box: { minLat: number; maxLat: number; minLon: number; maxLon: number },
    ): StopPosition[] {
      return db
        .prepare(
          `SELECT st.shift_id AS shiftId, s.status AS status, st.lat_e7 AS latE7, st.lon_e7 AS lonE7
             FROM stops st JOIN shifts s ON s.id = st.shift_id
            WHERE s.user_id = ? AND s.segmenter = 'stops' AND s.status IN ('ended','finalized')
              AND st.lat_e7 BETWEEN ? AND ? AND st.lon_e7 BETWEEN ? AND ?`,
        )
        .all(userId, box.minLat, box.maxLat, box.minLon, box.maxLon) as StopPosition[];
    },
    /** Shifts with a stop that carries this place now (what the last engine run matched). */
    shiftsMatching(userId: number, placeId: number): StopPosition[] {
      return db
        .prepare(
          `SELECT DISTINCT st.shift_id AS shiftId, s.status AS status, 0 AS latE7, 0 AS lonE7
             FROM stops st JOIN shifts s ON s.id = st.shift_id
            WHERE s.user_id = ? AND st.place_id = ? AND s.status IN ('ended','finalized')`,
        )
        .all(userId, placeId) as StopPosition[];
    },
  };
}
