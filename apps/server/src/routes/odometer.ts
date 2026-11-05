import type { FastifyInstance } from 'fastify';
import {
  createOdometerRepository,
  createSettingsRepository,
  createShiftRepository,
  createVehicleRepository,
  type Db,
  type OdometerRow,
} from '../db';
import { ProblemError } from '../errors';
import { localDate } from '../time';
import { idParams, snakeKeys, strictObject, type AuthFn } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const query = strictObject(
  {
    vehicle_id: { type: 'integer', minimum: 1 },
    kind: { enum: ['shift_start', 'shift_end', 'year_start', 'year_end'] },
    from: date,
    to: date,
  },
  [],
);
const create = strictObject(
  {
    vehicle_id: { type: 'integer', minimum: 1 },
    kind: { enum: ['year_start', 'year_end'] },
    reading_m: { type: 'integer', minimum: 0 },
    recorded_at: { type: 'integer', minimum: 0 },
  },
  ['vehicle_id', 'kind', 'reading_m', 'recorded_at'],
);
const LIMIT = 500;

export const odometerView = (r: OdometerRow) => snakeKeys(r, 'userId');

/** The odometer review and the fiscal-year readings the CRA asks for (08 section 3, 07 section 2.2). Web session only. */
export function odometerRoutes(
  app: FastifyInstance,
  { db, now, auth }: { db: Db; now: () => number; auth: AuthFn },
) {
  const readings = createOdometerRepository(db);
  const vehicles = createVehicleRepository(db);
  const shifts = createShiftRepository(db);
  const zone = (userId: number) => createSettingsRepository(db).get(userId)?.timezone ?? 'UTC';

  app.get('/odometer', { schema: { querystring: query } }, async (req) => {
    const { userId } = auth(req, 'S');
    const q = req.query as {
      vehicle_id?: number;
      kind?: OdometerRow['kind'];
      from?: string;
      to?: string;
    };
    const tz = zone(userId);
    return readings
      .list(userId, { vehicleId: q.vehicle_id, kind: q.kind })
      .filter((r) => {
        const day = localDate(r.recordedAt, tz);
        return (q.from === undefined || day >= q.from) && (q.to === undefined || day <= q.to);
      })
      .slice(0, LIMIT)
      .map(odometerView);
  });

  app.post('/odometer', { schema: { body: create } }, async (req, reply) => {
    const { userId } = auth(req, 'S');
    const b = req.body as {
      vehicle_id: number;
      kind: 'year_start' | 'year_end';
      reading_m: number;
      recorded_at: number;
    };
    const errors = [];
    if (!vehicles.find(userId, b.vehicle_id))
      errors.push({ path: '/vehicle_id', message: 'no such vehicle' });
    if (b.recorded_at > now() + 5 * 60 * 1000) {
      errors.push({
        path: '/recorded_at',
        message: 'must not be more than 5 minutes in the future',
      });
    }
    if (errors.length)
      throw new ProblemError('validation_failed', 'The request is not valid.', errors);
    const row = readings.insert({
      userId,
      vehicleId: b.vehicle_id,
      shiftId: null,
      kind: b.kind,
      readingM: b.reading_m,
      recordedAt: b.recorded_at,
    });
    return reply.status(201).send(odometerView(row));
  });

  app.delete('/odometer/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { userId } = auth(req, 'S');
    const row = readings.byId(userId, (req.params as { id: number }).id);
    if (!row) throw new ProblemError('not_found', 'No such reading.');
    // A finalized shift is the driver's tax record: its readings stay (08 section 4.4).
    const shift = row.shiftId === null ? undefined : shifts.byRef(userId, String(row.shiftId));
    if (shift?.status === 'finalized') {
      throw new ProblemError('shift_finalized', 'This shift is finalized.');
    }
    readings.remove(row.id);
    return reply.status(204).send();
  });
}
