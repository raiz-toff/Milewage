import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { users } from './schema';

type User = typeof users.$inferSelect;
type NewUser = typeof users.$inferInsert;

// One repository per aggregate; routes never touch tables.
export function createUserRepository(db: Db) {
  const orm = drizzle(db);
  return {
    count: (): number => orm.select({ n: count() }).from(users).get()?.n ?? 0,
    findByUsername: (username: string): User | undefined =>
      orm.select().from(users).where(eq(users.username, username)).get(),
    create: (row: NewUser): User => orm.insert(users).values(row).returning().get(),
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
