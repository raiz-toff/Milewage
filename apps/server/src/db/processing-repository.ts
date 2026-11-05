import { and, asc, count, eq, gte, inArray, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Fix } from '@milewage/track-engine';
import type { Db } from './open';
import { shiftFlags, shifts, stopLabels, stops, telemetryPoints, trips } from './schema';

export type TripRow = typeof trips.$inferSelect;
export type FlagRow = typeof shiftFlags.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type StopLabelRow = typeof stopLabels.$inferSelect;
export type ShiftPatch = Partial<typeof shifts.$inferSelect>;

export interface DerivedWrite {
  userId: number;
  shiftId: number;
  now: number;
  shift: ShiftPatch;
  trips: Omit<typeof trips.$inferInsert, 'userId' | 'shiftId' | 'source'>[];
  flags: Pick<typeof shiftFlags.$inferInsert, 'code' | 'severity' | 'detail'>[];
  /** `undefined` leaves the stops table alone (stops module off). */
  stops?: Omit<typeof stops.$inferInsert, 'userId' | 'shiftId'>[];
}

/** Everything the shift processor reads and writes: points in, derived trips, flags and stops out. */
export function createProcessingRepository(db: Db) {
  const orm = drizzle(db);
  return {
    /** The shift's stored points as engine fixes, in any order (the engine sorts). */
    fixesOf(shiftId: number): Fix[] {
      return orm
        .select()
        .from(telemetryPoints)
        .where(eq(telemetryPoints.shiftId, shiftId))
        .orderBy(asc(telemetryPoints.recordedAt), asc(telemetryPoints.seq))
        .all()
        .map((r) => ({
          seq: r.seq,
          recordedAt: r.recordedAt,
          latE7: r.latE7,
          lonE7: r.lonE7,
          accuracyM: r.accuracyM,
          ...(r.speedDmps === null ? {} : { speedDmps: r.speedDmps }),
          ...(r.bearingDeg === null ? {} : { bearingDeg: r.bearingDeg }),
          ...(r.altitudeM === null ? {} : { altitudeM: r.altitudeM }),
        }));
    },
    /** Stored points with a seq in `[first, last]` (both given) or all of them. */
    countPoints(shiftId: number, first?: number, last?: number): number {
      return (
        orm
          .select({ n: count() })
          .from(telemetryPoints)
          .where(
            and(
              eq(telemetryPoints.shiftId, shiftId),
              first === undefined ? undefined : gte(telemetryPoints.seq, first),
              last === undefined ? undefined : lte(telemetryPoints.seq, last),
            ),
          )
          .get()?.n ?? 0
      );
    },
    labelsOf: (shiftId: number): StopLabelRow[] =>
      orm.select().from(stopLabels).where(eq(stopLabels.shiftId, shiftId)).all(),
    tripsOf: (shiftId: number): TripRow[] =>
      orm
        .select()
        .from(trips)
        .where(eq(trips.shiftId, shiftId))
        .orderBy(asc(trips.startedAt), asc(trips.id))
        .all(),
    stopsOf: (shiftId: number): StopRow[] =>
      orm
        .select()
        .from(stops)
        .where(eq(stops.shiftId, shiftId))
        .orderBy(asc(stops.startedAt), asc(stops.id))
        .all(),
    flagsOf(shiftIds: readonly number[]): Map<number, FlagRow[]> {
      const out = new Map<number, FlagRow[]>();
      if (shiftIds.length === 0) return out;
      const rows = orm
        .select()
        .from(shiftFlags)
        .where(inArray(shiftFlags.shiftId, [...shiftIds]))
        .orderBy(asc(shiftFlags.id))
        .all();
      for (const r of rows) out.set(r.shiftId, [...(out.get(r.shiftId) ?? []), r]);
      return out;
    },
    /** Replaces the derived rows of one shift and updates the shift, all in one transaction. */
    writeDerived(w: DerivedWrite): typeof shifts.$inferSelect | undefined {
      return orm.transaction((tx) => {
        const ids = { userId: w.userId, shiftId: w.shiftId };
        tx.delete(trips)
          .where(and(eq(trips.shiftId, w.shiftId), eq(trips.source, 'auto')))
          .run();
        for (const t of w.trips)
          tx.insert(trips)
            .values({ ...ids, ...t, source: 'auto' })
            .run();
        tx.delete(shiftFlags).where(eq(shiftFlags.shiftId, w.shiftId)).run();
        for (const f of w.flags)
          tx.insert(shiftFlags)
            .values({ ...ids, ...f, createdAt: w.now })
            .run();
        if (w.stops) {
          tx.delete(stops).where(eq(stops.shiftId, w.shiftId)).run();
          for (const s of w.stops)
            tx.insert(stops)
              .values({ ...ids, ...s })
              .run();
        }
        return tx.update(shifts).set(w.shift).where(eq(shifts.id, w.shiftId)).returning().get();
      });
    },
  };
}
