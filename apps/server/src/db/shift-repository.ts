import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { shifts } from './schema';

export type ShiftRow = typeof shifts.$inferSelect;

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
