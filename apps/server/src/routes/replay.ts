import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createArchiveRepository, telemetryPoints, type Db } from '../db';
import { refParam, strictObject, type Principal } from './util';
import type { ShiftBook } from '../processing/shift-book';

const params = strictObject({ ref: refParam }, ['ref']);

/** `GET /shifts/{ref}/route`: the stored points as parallel arrays for the map and the scrubber (module `replay`). */
export function replayRoutes({
  db,
  book,
  authn,
}: {
  db: Db;
  book: ShiftBook;
  authn: Authenticator;
}) {
  return ({ app }: ServerRouteHost) => {
    const orm = drizzle(db);
    const read = (p: Principal, ref: string) => book.find(p, ref);
    const archives = createArchiveRepository(db);

    app.get('/shifts/:ref/route', { schema: { params } }, async (req) => {
      const p = authn.authenticate(req, 'SD');
      const shift = read(p, (req.params as { ref: string }).ref);
      const rows = orm
        .select({
          t: telemetryPoints.recordedAt,
          lat: telemetryPoints.latE7,
          lon: telemetryPoints.lonE7,
          speed: telemetryPoints.speedDmps,
        })
        .from(telemetryPoints)
        .where(eq(telemetryPoints.shiftId, shift.id))
        .orderBy(asc(telemetryPoints.recordedAt), asc(telemetryPoints.seq))
        .all();
      const archive = rows.length === 0 ? archives.archiveOf(shift.id) : undefined;
      if (archive) {
        // The raw points were replaced by the simplified route (07 section 4.2): no speeds are kept.
        const g = JSON.parse(archive.geometry) as {
          coordinates: [number, number][];
          properties: { times: number[] };
        };
        return {
          source: 'archive',
          t: g.properties.times.map((s) => s * 1000),
          lat_e7: g.coordinates.map((c) => Math.round(c[1] * 1e7)),
          lon_e7: g.coordinates.map((c) => Math.round(c[0] * 1e7)),
          speed_dmps: g.coordinates.map(() => null),
        };
      }
      return {
        source: 'raw',
        t: rows.map((r) => r.t),
        lat_e7: rows.map((r) => r.lat),
        lon_e7: rows.map((r) => r.lon),
        speed_dmps: rows.map((r) => r.speed),
      };
    });
  };
}
