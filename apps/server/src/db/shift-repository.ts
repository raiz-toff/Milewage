import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { odometerReadings, shifts } from './schema';

export type ShiftRow = typeof shifts.$inferSelect;
export type OdometerRow = typeof odometerReadings.$inferSelect;
export type OdometerKind = OdometerRow['kind'];

export interface ShiftFilter {
  status?: ShiftRow['status'];
  vehicleId?: number;
  from?: string;
  to?: string;
  /** Keyset position of the last row of the previous page. */
  after?: { startedAt: number; id: number };
  limit: number;
}

const maybe = <T>(v: T | undefined, f: (v: T) => SQL | undefined) =>
  v === undefined ? undefined : f(v);

export function createShiftRepository(db: Db) {
  const orm = drizzle(db);
  /** `since` is the device read window: started, or written to by a device, at or after it. */
  const visible = (userId: number, since?: number) =>
    and(
      eq(shifts.userId, userId),
      since === undefined
        ? undefined
        : or(gte(shifts.startedAt, since), gte(shifts.deviceTouchedAt, since)),
    );
  const one = (where: ReturnType<typeof and>) => orm.select().from(shifts).where(where).get();
  return {
    byRef(userId: number, ref: string, since?: number): ShiftRow | undefined {
      const key = /^\d+$/.test(ref)
        ? eq(shifts.id, Number(ref))
        : eq(shifts.clientId, ref.toLowerCase());
      return one(and(visible(userId, since), key));
    },
    byId: (id: number): ShiftRow | undefined => one(eq(shifts.id, id)),
    byClientId: (userId: number, clientId: string) =>
      one(and(eq(shifts.userId, userId), eq(shifts.clientId, clientId))),
    active: (userId: number) => one(and(eq(shifts.userId, userId), eq(shifts.status, 'active'))),
    insert: (row: typeof shifts.$inferInsert): ShiftRow =>
      orm.insert(shifts).values(row).returning().get(),
    update: (id: number, set: Partial<ShiftRow>): ShiftRow | undefined =>
      orm.update(shifts).set(set).where(eq(shifts.id, id)).returning().get(),
    /** Newest first, by (started_at, id). Returns up to `limit + 1` rows so the caller can tell if more exist. */
    list(userId: number, f: ShiftFilter, since?: number): ShiftRow[] {
      const after = f.after;
      return orm
        .select()
        .from(shifts)
        .where(
          and(
            visible(userId, since),
            maybe(f.status, (v) => eq(shifts.status, v)),
            maybe(f.vehicleId, (v) => eq(shifts.vehicleId, v)),
            maybe(f.from, (v) => gte(shifts.localDate, v)),
            maybe(f.to, (v) => lte(shifts.localDate, v)),
            maybe(after, (a) =>
              or(
                lt(shifts.startedAt, a.startedAt),
                and(eq(shifts.startedAt, a.startedAt), lt(shifts.id, a.id)),
              ),
            ),
          ),
        )
        .orderBy(desc(shifts.startedAt), desc(shifts.id))
        .limit(f.limit + 1)
        .all();
    },
  };
}

export function createOdometerRepository(db: Db) {
  const orm = drizzle(db);
  const find = (shiftId: number, kind: OdometerKind) =>
    orm
      .select()
      .from(odometerReadings)
      .where(and(eq(odometerReadings.shiftId, shiftId), eq(odometerReadings.kind, kind)))
      .get();
  return {
    find,
    byId: (userId: number, id: number): OdometerRow | undefined =>
      orm
        .select()
        .from(odometerReadings)
        .where(and(eq(odometerReadings.userId, userId), eq(odometerReadings.id, id)))
        .get(),
    /** Newest first; the caller applies the date window, which needs the owner's time zone. */
    list: (userId: number, f: { vehicleId?: number; kind?: OdometerKind }): OdometerRow[] =>
      orm
        .select()
        .from(odometerReadings)
        .where(
          and(
            eq(odometerReadings.userId, userId),
            maybe(f.vehicleId, (v) => eq(odometerReadings.vehicleId, v)),
            maybe(f.kind, (k) => eq(odometerReadings.kind, k)),
          ),
        )
        .orderBy(desc(odometerReadings.recordedAt), desc(odometerReadings.id))
        .all(),
    insert: (row: typeof odometerReadings.$inferInsert): OdometerRow =>
      orm.insert(odometerReadings).values(row).returning().get(),
    remove: (id: number) =>
      void orm.delete(odometerReadings).where(eq(odometerReadings.id, id)).run(),
    /** Upsert on (shift, kind). */
    set(row: typeof odometerReadings.$inferInsert & { shiftId: number }): OdometerRow {
      const old = find(row.shiftId, row.kind);
      if (!old) return orm.insert(odometerReadings).values(row).returning().get();
      return orm
        .update(odometerReadings)
        .set({ readingM: row.readingM, recordedAt: row.recordedAt })
        .where(eq(odometerReadings.id, old.id))
        .returning()
        .get() as OdometerRow;
    },
  };
}
