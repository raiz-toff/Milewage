import { and, count, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ProblemError } from '../errors';
import type { Db } from './open';
import { instance, settings, users, webSessions } from './schema';

type User = typeof users.$inferSelect;
type NewUser = typeof users.$inferInsert;
type NewSettings = Omit<typeof settings.$inferInsert, 'userId' | 'updatedAt'>;
type Session = typeof webSessions.$inferSelect;

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

export type UserRepository = ReturnType<typeof createUserRepository>;
export type SessionRepository = ReturnType<typeof createSessionRepository>;
