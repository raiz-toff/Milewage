import { and, count, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ProblemError } from '../errors';
import type { Db } from './open';
import { devices, instance, pairingTokens, settings, users, vehicles, webSessions } from './schema';

type User = typeof users.$inferSelect;
type NewUser = typeof users.$inferInsert;
type NewSettings = Omit<typeof settings.$inferInsert, 'userId' | 'updatedAt'>;
type Session = typeof webSessions.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

// One repository per aggregate; routes never touch tables.
export function createUserRepository(db: Db) {
  const orm = drizzle(db);
  return {
    count: (): number => orm.select({ n: count() }).from(users).get()?.n ?? 0,
    findByUsername: (username: string): User | undefined =>
      orm.select().from(users).where(eq(users.username, username)).get(),
    findById: (id: number): User | undefined =>
      orm.select().from(users).where(eq(users.id, id)).get(),
    create: (row: NewUser): User => orm.insert(users).values(row).returning().get(),
    setPasswordHash: (id: number, hash: string) =>
      void orm.update(users).set({ passwordHash: hash }).where(eq(users.id, id)).run(),
    createOwner(row: NewUser, prefs: NewSettings, instanceId: string): User {
      return orm.transaction((tx) => {
        if ((tx.select({ n: count() }).from(users).get()?.n ?? 0) > 0) {
          throw new ProblemError('setup_already_done', 'This instance already has an owner.');
        }
        const user = tx.insert(users).values(row).returning().get();
        tx.insert(settings)
          .values({ ...prefs, userId: user.id, updatedAt: row.createdAt })
          .run();
        tx.insert(instance).values({ id: 1, instanceId }).run();
        return user;
      });
    },
  };
}

export function createSessionRepository(db: Db) {
  const orm = drizzle(db);
  const byHash = (h: string) => eq(webSessions.idHash, h);
  return {
    create: (row: Session) => void orm.insert(webSessions).values(row).run(),
    find: (idHash: string): Session | undefined =>
      orm.select().from(webSessions).where(byHash(idHash)).get(),
    touch: (idHash: string, lastSeenAt: number, expiresAt: number) =>
      void orm.update(webSessions).set({ lastSeenAt, expiresAt }).where(byHash(idHash)).run(),
    delete: (idHash: string) => void orm.delete(webSessions).where(byHash(idHash)).run(),
    deleteOthers: (userId: number, keep: string) =>
      void orm
        .delete(webSessions)
        .where(and(eq(webSessions.userId, userId), ne(webSessions.idHash, keep)))
        .run(),
  };
}

export function createSettingsRepository(db: Db) {
  const orm = drizzle(db);
  const mine = (userId: number) => eq(settings.userId, userId);
  return {
    get: (userId: number): SettingsRow | undefined =>
      orm.select().from(settings).where(mine(userId)).get(),
    update: (userId: number, patch: Partial<SettingsRow>): SettingsRow | undefined =>
      orm.update(settings).set(patch).where(mine(userId)).returning().get(),
  };
}

export function createVehicleRepository(db: Db) {
  const orm = drizzle(db);
  const mine = (userId: number, id: number) =>
    and(eq(vehicles.userId, userId), eq(vehicles.id, id));
  return {
    list: (userId: number, includeArchived: boolean): VehicleRow[] =>
      orm
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .orderBy(vehicles.id)
        .all()
        .filter((v) => includeArchived || v.archivedAt === null),
    find: (userId: number, id: number): VehicleRow | undefined =>
      orm.select().from(vehicles).where(mine(userId, id)).get(),
    create: (row: typeof vehicles.$inferInsert): VehicleRow =>
      orm.insert(vehicles).values(row).returning().get(),
    update: (userId: number, id: number, patch: Partial<VehicleRow>): VehicleRow | undefined =>
      orm.update(vehicles).set(patch).where(mine(userId, id)).returning().get(),
  };
}

/** The one `instance` row (install id and restore generation); undefined before setup. */
export function createInstanceReader(db: Db) {
  const orm = drizzle(db);
  return () => orm.select().from(instance).get();
}

export type DeviceRow = typeof devices.$inferSelect;

export function createDeviceRepository(db: Db) {
  const orm = drizzle(db);
  const mine = (userId: number, id: number) => and(eq(devices.userId, userId), eq(devices.id, id));
  const patch = (userId: number, id: number, set: Partial<DeviceRow>) =>
    orm.update(devices).set(set).where(mine(userId, id)).returning().get();
  return {
    addPairingToken: (row: typeof pairingTokens.$inferInsert) =>
      void orm.insert(pairingTokens).values(row).run(),
    /** The token is consumed and the device created in one transaction, or neither. */
    redeem(
      tokenHash: string,
      now: number,
      device: Pick<DeviceRow, 'name' | 'platform' | 'tokenHash'>,
    ) {
      return orm.transaction((tx) => {
        const t = tx
          .select()
          .from(pairingTokens)
          .where(eq(pairingTokens.tokenHash, tokenHash))
          .get();
        if (!t || t.usedAt !== null || t.expiresAt <= now) return undefined;
        tx.update(pairingTokens).set({ usedAt: now }).where(eq(pairingTokens.id, t.id)).run();
        return tx
          .insert(devices)
          .values({ ...device, userId: t.userId, createdAt: now })
          .returning()
          .get();
      });
    },
    findByTokenHash: (hash: string): DeviceRow | undefined =>
      orm.select().from(devices).where(eq(devices.tokenHash, hash)).get(),
    list: (userId: number): DeviceRow[] =>
      orm.select().from(devices).where(eq(devices.userId, userId)).orderBy(devices.id).all(),
    find: (userId: number, id: number): DeviceRow | undefined =>
      orm.select().from(devices).where(mine(userId, id)).get(),
    rename: (userId: number, id: number, name: string) => patch(userId, id, { name }),
    revoke: (userId: number, id: number, at: number) => patch(userId, id, { revokedAt: at }),
    seen: (id: number, at: number) =>
      void orm.update(devices).set({ lastSeenAt: at }).where(eq(devices.id, id)).run(),
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
export type SessionRepository = ReturnType<typeof createSessionRepository>;
