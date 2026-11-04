/* eslint-disable @typescript-eslint/no-require-imports */
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
