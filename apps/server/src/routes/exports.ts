import { Readable } from 'node:stream';
import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createProcessingRepository,
  createSettingsRepository,
  createShiftRepository,
  createArchiveRepository,
  createVehicleRepository,
  createEarningsRepository,
  type Db,
  type ShiftRow,
} from '../db';
import { ProblemError } from '../errors';
import type { ExporterRegistry } from '../exporters/registry';
import { deductionOfShift } from '../processing/presenter';
import type { EarningsPolicy } from './earnings';
import { strictObject } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const query = strictObject(
  {
    from: date,
    to: date,
    shift_id: { type: 'integer', minimum: 1 },
    vehicle_id: { type: 'integer', minimum: 1 },
    level: { enum: ['trip', 'shift'] },
  },
  [],
);
const DAY = 86_400_000;
const calendar = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d) ? t : undefined;
};
const bad = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

export interface ExportsOptions {
  db: Db;
  authn: Authenticator;
  exporters: ExporterRegistry;
  /** Formats switched on (`modules.export_<format>`); default every registered one. */
  formats?: () => readonly string[];
  earnings?: (registry: ServerRouteHost['registry']) => EarningsPolicy;
}

/** Formats that exist right now: registered, switched on, and with their required modules on. */
export function availableFormats(
  exporters: ExporterRegistry,
  isEnabled: (module: string) => boolean,
  formats?: () => readonly string[],
): string[] {
  const on = formats?.() ?? exporters.formats();
  return exporters
    .formats()
    .filter((f) => on.includes(f) && (exporters.get(f)?.requires ?? []).every(isEnabled));
}

/** `GET /exports/{format}` (08 section 11): a streamed file from a registered exporter. Web session only. */
export function exportsRoutes({ db, authn, exporters, formats, earnings }: ExportsOptions) {
  return (host: RouteHost) => {
    const { app, registry } = host as ServerRouteHost;
    const processing = createProcessingRepository(db);
    const settings = createSettingsRepository(db);
    const shiftRepo = createShiftRepository(db);

    app.get('/exports/:format', { schema: { querystring: query } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const format = (req.params as { format: string }).format;
      // An unknown, switched-off or unsatisfied format is a plain 404, the same as a route that never existed.
      if (!availableFormats(exporters, (m) => registry.isEnabled(m), formats).includes(format)) {
        throw new ProblemError('not_found', 'No such export format.');
      }
      const exporter = exporters.get(format)!;
      const q = req.query as {
        from?: string;
        to?: string;
        shift_id?: number;
        vehicle_id?: number;
        level?: 'trip' | 'shift';
      };
      const prefs = settings.get(userId);
      if (!prefs) throw new ProblemError('setup_incomplete', 'Finish setup first.');

      let shifts: ShiftRow[];
      let name: string;
      if (q.shift_id !== undefined) {
        if (q.from || q.to) throw bad('/shift_id', 'use shift_id or from and to, not both');
        const s = shiftRepo.byRef(userId, String(q.shift_id));
        if (!s) throw new ProblemError('shift_not_found', 'No such shift.');
        shifts = s.status === 'active' ? [] : [s];
        name = `shift-${s.id}`;
      } else {
        if (!q.from || !q.to) throw bad('/from', 'give from and to (or shift_id)');
        const a = calendar(q.from);
        const b = calendar(q.to);
        if (a === undefined) throw bad('/from', 'is not a calendar date');
        if (b === undefined) throw bad('/to', 'is not a calendar date');
        if (b < a) throw bad('/from', 'must not be after to');
        if ((b - a) / DAY > 365) throw bad('/to', 'at most 366 days after from');
        shifts = processing.shiftsInPeriod(userId, q.from, q.to);
        name = `${q.from}_${q.to}`;
      }
      if (q.vehicle_id !== undefined) shifts = shifts.filter((s) => s.vehicleId === q.vehicle_id);

      const vehicles = new Map(
        createVehicleRepository(db)
          .list(userId, true)
          .map((v) => [v.id, v]),
      );
      const archive = createArchiveRepository(db);
      const points = db.prepare(
        'SELECT recorded_at AS t, lat_e7 AS latE7, lon_e7 AS lonE7, speed_dmps AS speedDmps, altitude_m AS altitudeM FROM telemetry_points WHERE shift_id = ? ORDER BY recorded_at, seq',
      );
      const chunks = exporter.run({
        db,
        userId,
        shifts,
        vehicles,
        unit: prefs.distanceUnit,
        currency: prefs.currency,
        timeZone: prefs.timezone,
        level: q.level ?? 'trip',
        stopsOn: prefs.stopsEnabled === 1 && registry.isEnabled('stops'),
        readers: {
          trips: processing.tripsOf,
          stops: processing.stopsOf,
          labels: processing.labelsOf,
          // A shift at a time, not a live cursor: other requests share the one connection.
          points: (id) => {
            const raw = points.all(id) as {
              t: number;
              latE7: number;
              lonE7: number;
              speedDmps: number | null;
              altitudeM: number | null;
            }[];
            if (raw.length > 0) return raw;
            const a = archive.archiveOf(id);
            if (!a) return raw;
            const g = JSON.parse(a.geometry) as {
              coordinates: [number, number][];
              properties: { times: number[] };
            };
            return g.coordinates.map((c, i) => ({
              t: g.properties.times[i]! * 1000,
              latE7: Math.round(c[1] * 1e7),
              lonE7: Math.round(c[0] * 1e7),
              speedDmps: null,
              altitudeM: null,
            }));
          },
          simplified: (id) => archive.hasArchive(id),
          deduction: (s) => deductionOfShift(db, s),
          earnings: (s) =>
            earnings
              ? createEarningsRepository(db)
                  .effective(userId, s.localDate, s.localDate, earnings(registry).options(userId))
                  .filter((r) => r.shiftId === s.id)
              : [],
        },
      });
      return reply
        .header('Content-Type', exporter.contentType)
        .header(
          'Content-Disposition',
          `attachment; filename="milewage-${name}.${exporter.extension}"`,
        )
        .send(Readable.from(chunks, { objectMode: false }));
    });
  };
}
