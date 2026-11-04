import { desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { backupRuns, users } from './schema';

export type BackupRunRow = typeof backupRuns.$inferSelect;

export function createBackupRepository(db: Db) {
  const orm = drizzle(db);
  return {
    /** The single owner; backups have nothing to record before setup. */
    ownerId: (): number | undefined =>
      orm.select({ id: users.id }).from(users).orderBy(users.id).get()?.id,
    insert: (row: typeof backupRuns.$inferInsert): BackupRunRow =>
      orm.insert(backupRuns).values(row).returning().get(),
    /** Newest first. */
    list: (): BackupRunRow[] => orm.select().from(backupRuns).orderBy(desc(backupRuns.id)).all(),
    byId: (id: number): BackupRunRow | undefined =>
      orm.select().from(backupRuns).where(eq(backupRuns.id, id)).get(),
    deleteByFile: (names: readonly string[]) =>
      void (
        names.length &&
        orm
          .delete(backupRuns)
          .where(inArray(backupRuns.fileName, [...names]))
          .run()
      ),
  };
}
