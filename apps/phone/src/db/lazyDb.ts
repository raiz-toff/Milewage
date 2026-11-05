import { openAppDb, type AppSqlDb, type MigrateOptions, type SqlValue } from './appDb';

/**
 * `app.db` opened and migrated on first use, so the object graph can be built synchronously
 * (the same pattern as the key-value store). A failed open is retried on the next call.
 */
export function createLazyAppDb(
  open: () => Promise<AppSqlDb>,
  opts: MigrateOptions = {},
): AppSqlDb {
  let ready: Promise<AppSqlDb> | null = null;
  const db = (): Promise<AppSqlDb> => {
    ready ??= openAppDb(open, opts);
    ready.catch(() => {
      ready = null;
    });
    return ready;
  };
  return {
    execAsync: async (sql) => (await db()).execAsync(sql),
    runAsync: async (sql, ...p) => (await db()).runAsync(sql, ...p),
    getFirstAsync: async <T>(sql: string, ...p: SqlValue[]) =>
      (await db()).getFirstAsync<T>(sql, ...p),
    getAllAsync: async <T>(sql: string, ...p: SqlValue[]) => (await db()).getAllAsync<T>(sql, ...p),
    withTransactionAsync: async (task) => (await db()).withTransactionAsync(task),
  };
}
