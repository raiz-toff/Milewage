/* eslint-disable @typescript-eslint/no-require-imports */
import type { AppSqlDb, SqlValue } from '../../src/db/appDb';
import type { SqlDb } from '../../src/storage/sqliteStore';

/** A real SQLite (Node's built-in) behind the same interface as `expo-sqlite`. */
export function openNodeDb(path = ':memory:'): SqlDb & { close(): void } {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path);
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, ...p) => db.prepare(sql).run(...p),
    getFirstAsync: async <T>(sql: string, ...p: (string | number)[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    close: () => db.close(),
  } as SqlDb & { close(): void };
}

/** Node's SQLite behind the `app.db` interface (foreign keys on, transactions by BEGIN/COMMIT). */
export function openNodeAppDb(path = ':memory:'): AppSqlDb & { close(): void } {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return {
    execAsync: async (sql: string) => void db.exec(sql),
    runAsync: async (sql: string, ...p: SqlValue[]) => {
      const r = db.prepare(sql).run(...p);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async <T>(sql: string, ...p: SqlValue[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, ...p: SqlValue[]) => db.prepare(sql).all(...p) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  } as AppSqlDb & { close(): void };
}
