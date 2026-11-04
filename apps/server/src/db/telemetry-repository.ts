import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './open';
import { telemetryPoints } from './schema';

export type NewPoint = typeof telemetryPoints.$inferInsert;

export function createTelemetryRepository(db: Db) {
  const orm = drizzle(db);
  return {
    /**
     * One transaction, `ON CONFLICT (device_id, seq) DO NOTHING`: a retried batch is safe.
     * Returns how many rows were new; if the transaction fails nothing is stored.
     */
    insert: (rows: readonly NewPoint[]): number =>
      orm.transaction((tx) =>
        rows.reduce(
          (n, row) =>
            n +
            tx
              .insert(telemetryPoints)
              .values(row)
              .onConflictDoNothing({ target: [telemetryPoints.deviceId, telemetryPoints.seq] })
              .run().changes,
          0,
        ),
      ),
  };
}
