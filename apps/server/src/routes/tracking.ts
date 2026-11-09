import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createShiftRepository, createTelemetryRepository, type Db, type NewPoint } from '../db';
import { ProblemError } from '../errors';
import type { ShiftProcessor } from '../processing/shift-processor';
import { overrideRoutes } from './trips';
import { strictObject } from './util';

const MIN = 60 * 1000;
const MAX_POINTS = 500;
const int = { type: 'integer' };
// Coordinates are checked per point, not by the schema: a bad one is listed in `rejected`, it never fails the batch.
const point = strictObject(
  {
    seq: { type: 'integer', minimum: 1 },
    recorded_at: { type: 'integer', minimum: 0 },
    lat_e7: int,
    lon_e7: int,
    accuracy_m: { type: 'integer', minimum: 0 },
    speed_dmps: { type: ['integer', 'null'], minimum: 0 },
    bearing_deg: { type: ['integer', 'null'], minimum: 0, maximum: 359 },
    altitude_m: { type: ['integer', 'null'] },
  },
  ['seq', 'recorded_at', 'lat_e7', 'lon_e7', 'accuracy_m'],
);
const batch = strictObject(
  {
    shift_client_id: { type: 'string', format: 'uuid' },
    points: { type: 'array', minItems: 1, items: point },
  },
  ['shift_client_id', 'points'],
);
type Point = {
  seq: number;
  recorded_at: number;
  lat_e7: number;
  lon_e7: number;
  accuracy_m: number;
} & {
  speed_dmps?: number | null;
  bearing_deg?: number | null;
  altitude_m?: number | null;
};
type Refusal = 'invalid_coordinate' | 'future_timestamp' | 'outside_shift_window';

/** Telemetry ingest (08 section 5): the hot path. 256 KiB compressed, 1 MiB decompressed, 500 points. */
export function trackingRoutes({
  db,
  now,
  authn,
  processor,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  processor?: ShiftProcessor;
}) {
  return ({ app, bus }: ServerRouteHost) => {
    const shifts = createShiftRepository(db);
    const telemetry = createTelemetryRepository(db);
    if (processor) {
      overrideRoutes(app, {
        db,
        now,
        auth: authn.authenticate,
        processor,
        emit: bus.emit,
        trackingOn: () => true,
      });
    }

    app.post(
      '/telemetry/batch',
      {
        bodyLimit: 1024 * 1024,
        config: { maxEncoded: 256 * 1024, rateLimit: 'telemetry' },
        schema: { body: batch },
      },
      async (req) => {
        const device = authn.authenticate(req, 'D');
        const b = req.body as { shift_client_id: string; points: Point[] };
        if (b.points.length > MAX_POINTS) {
          throw new ProblemError('payload_too_large', `At most ${MAX_POINTS} points per batch.`);
        }
        const t = now();
        const shift = shifts.byRef(device.userId, b.shift_client_id, t - 14 * 24 * 60 * MIN);
        if (!shift) throw new ProblemError('shift_not_found', 'No such shift.');
        if (shift.status === 'finalized') {
          throw new ProblemError(
            'shift_finalized',
            'Points can no longer be added to a finalized shift.',
          );
        }
        const from = shift.startedAt - 5 * MIN;
        const to = shift.endedAt === null ? t + 5 * MIN : shift.endedAt + 10 * MIN;
        const refusal = (p: Point): Refusal | undefined => {
          if (Math.abs(p.lat_e7) > 900_000_000 || Math.abs(p.lon_e7) > 1_800_000_000)
            return 'invalid_coordinate';
          if (p.recorded_at > t + 5 * MIN) return 'future_timestamp';
          if (p.recorded_at < from || p.recorded_at > to) return 'outside_shift_window';
        };
        const rejected: { seq: number; code: Refusal }[] = [];
        const rows: NewPoint[] = [];
        for (const p of b.points) {
          const code = refusal(p);
          if (code) rejected.push({ seq: p.seq, code });
          else {
            const {
              seq,
              recorded_at: recordedAt,
              lat_e7: latE7,
              lon_e7: lonE7,
              accuracy_m: accuracyM,
            } = p;
            const optional = {
              speedDmps: p.speed_dmps ?? null,
              bearingDeg: p.bearing_deg ?? null,
              altitudeM: p.altitude_m ?? null,
            };
            rows.push({
              userId: device.userId,
              deviceId: device.deviceId,
              shiftId: shift.id,
              seq,
              recordedAt,
              latE7,
              lonE7,
              accuracyM,
              ...optional,
            });
          }
        }
        const inserted = telemetry.insert(rows);
        shifts.update(shift.id, { deviceTouchedAt: t });
        const rejects: Record<string, number> = {};
        for (const r of rejected) rejects[r.code] = (rejects[r.code] ?? 0) + 1;
        bus.emit('telemetry.batch', {
          shiftId: String(shift.id),
          deviceId: String(device.deviceId),
          received: b.points.length,
          inserted,
          duplicates: rows.length - inserted,
          rejected: rejects,
        });
        if (inserted > 0) {
          bus.emit('telemetry.accepted', {
            shiftId: String(shift.id),
            deviceId: String(device.deviceId),
            count: inserted,
          });
        }
        // Only sizes and the outcome are logged, never coordinates (10 section 11.2).
        req.log.info(
          { points: b.points.length, inserted, rejected: rejected.length },
          'telemetry batch',
        );
        return {
          inserted,
          duplicates: rows.length - inserted,
          rejected,
          server_time: t,
          upload_hint_s: 60,
        };
      },
    );
  };
}
