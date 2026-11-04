import type { FastifyInstance } from 'fastify';
import {
  createOdometerRepository as odometerRepo,
  createSettingsRepository as settingsRepo,
  createShiftRepository as shiftRepo,
  createVehicleRepository as vehicleRepo,
  type Db,
  type ShiftRow,
} from '../db';
import { ProblemError } from '../errors';
import { snakeKeys, str, strictObject, type AuthFn, type Principal } from './util';

const DAY = 24 * 60 * 60 * 1000;
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ref = { type: 'string', pattern: `^([0-9]+|${UUID})$` };
const ms = { type: 'integer', minimum: 0 };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const status = { enum: ['active', 'ended', 'finalized'] };
const refParams = strictObject({ ref }, ['ref']);
const kindParams = strictObject({ ref, kind: { enum: ['shift_start', 'shift_end'] } }, [
  'ref',
  'kind',
]);

const start = strictObject(
  {
    client_id: { type: 'string', format: 'uuid' },
    vehicle_id: { type: 'integer', minimum: 1 },
    started_at: ms,
    segmenter: { enum: ['stops', 'whole_shift'] },
    notes: str(0, 2000),
  },
  ['client_id', 'vehicle_id', 'started_at'],
);
const patch = strictObject(
  {
    notes: { type: ['string', 'null'], maxLength: 2000 },
    vehicle_id: { type: 'integer', minimum: 1 },
    updated_at: ms,
  },
  [],
  { minProperties: 1 },
);
// manifest, phone_result and interruptions are accepted and ignored until the engine lands (M5.3).
const end = strictObject(
  {
    ended_at: ms,
    manifest: { type: 'object' },
    phone_result: { type: 'object' },
    interruptions: { type: 'array', maxItems: 200 },
  },
  ['ended_at'],
);
const reading = strictObject({ reading_m: ms, recorded_at: ms }, ['reading_m', 'recorded_at']);
const list = strictObject(
  {
    status,
    vehicle_id: { type: 'integer' },
    from: date,
    to: date,
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    cursor: str(1, 200),
  },
  [],
);

const shiftView = (r: ShiftRow) => ({
  ...snakeKeys(r, 'userId', 'deviceTouchedAt'),
  recon_reasons: r.reconReasons ? (JSON.parse(r.reconReasons) as string[]) : [],
  calc_mismatch: r.calcMismatch === 1,
  deduction_cents: null, // from the country registry at read time; no packs yet
  flags: [],
});
const localDate = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

/** The logbook's shift routes: start, read, list, edit notes or vehicle, odometer, a minimal end. */
export function shiftRoutes(
  app: FastifyInstance,
  { db, now, auth }: { db: Db; now: () => number; auth: AuthFn },
) {
  const shifts = shiftRepo(db);
  const odometer = odometerRepo(db);
  const vehicles = vehicleRepo(db);
  const device = (p: Principal) => p.kind === 'device';
  const touch = (p: Principal): Partial<ShiftRow> => (device(p) ? { deviceTouchedAt: now() } : {});
  /** A device sees shifts started in the last 14 days or written to by it in that time (08 section 2.2). */
  const since = (p: Principal) => (device(p) ? now() - 14 * DAY : undefined);
  const load = (p: Principal, r: string, open = true) => {
    const row = shifts.byRef(p.userId, r, since(p));
    if (!row) throw new ProblemError('shift_not_found', 'No such shift.');
    if (open && row.status === 'finalized')
      throw new ProblemError('shift_finalized', 'This shift is finalized.');
    return row;
  };
  /** Only the impossible is refused: a time more than 5 minutes ahead of the server (08 section 9). */
  const notFuture = (path: string, at: number) => {
    if (at > now() + 5 * 60 * 1000)
      throw invalid(path, 'must not be more than 5 minutes in the future');
  };
  const checkVehicle = (userId: number, id: number) => {
    if (!vehicles.find(userId, id)) throw invalid('/vehicle_id', 'no such vehicle');
  };
  const refOf = (req: { params: unknown }) => (req.params as { ref: string }).ref;

  app.post('/shifts', { schema: { body: start } }, async (req, reply) => {
    const p = auth(req, 'SD');
    const b = req.body as {
      client_id: string;
      vehicle_id: number;
      started_at: number;
      segmenter?: ShiftRow['segmenter'];
      notes?: string;
    };
    const clientId = b.client_id.toLowerCase();
    const same = shifts.byClientId(p.userId, clientId);
    if (same) return shiftView(same); // idempotent: returned unchanged
    notFuture('/started_at', b.started_at);
    checkVehicle(p.userId, b.vehicle_id);
    const active = shifts.active(p.userId);
    if (active) {
      const extra = { active_shift: shiftView(active) };
      throw new ProblemError(
        'shift_already_active',
        'Another shift is already active.',
        undefined,
        {},
        extra,
      );
    }
    const prefs = settingsRepo(db).get(p.userId);
    if (!prefs) throw new ProblemError('setup_incomplete', 'Finish setup first.');
    const row = shifts.insert({
      userId: p.userId,
      clientId,
      vehicleId: b.vehicle_id,
      status: 'active',
      startedAt: b.started_at,
      localDate: localDate(b.started_at, prefs.timezone),
      segmenter: b.segmenter ?? (prefs.stopsEnabled ? 'stops' : 'whole_shift'),
      notes: b.notes ?? null,
      updatedAt: b.started_at, // the edit clock starts at capture time, so offline edits made later still win
      ...touch(p),
    });
    return reply.status(201).send(shiftView(row));
  });

  app.get('/shifts', { schema: { querystring: list } }, async (req) => {
    const p = auth(req, 'SD');
    const q = req.query as {
      status?: ShiftRow['status'];
      vehicle_id?: number;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    };
    const limit = q.limit ?? 50;
    let after: { startedAt: number; id: number } | undefined;
    if (q.cursor) {
      try {
        const [startedAt, id] = JSON.parse(
          Buffer.from(q.cursor, 'base64url').toString(),
        ) as number[];
        if (!Number.isInteger(startedAt) || !Number.isInteger(id)) throw new Error('shape');
        after = { startedAt: startedAt as number, id: id as number };
      } catch {
        throw invalid('/cursor', 'is not a cursor from this server');
      }
    }
    const rows = shifts.list(p.userId, { ...q, vehicleId: q.vehicle_id, after, limit }, since(p));
    const last = rows[limit - 1];
    const next = rows.length > limit && last ? [last.startedAt, last.id] : null;
    return {
      items: rows.slice(0, limit).map(shiftView),
      next_cursor: next && Buffer.from(JSON.stringify(next)).toString('base64url'),
    };
  });

  app.get('/shifts/:ref', { schema: { params: refParams } }, async (req) =>
    shiftView(load(auth(req, 'SD'), refOf(req), false)),
  );

  app.patch('/shifts/:ref', { schema: { params: refParams, body: patch } }, async (req, reply) => {
    const p = auth(req, 'SD');
    const row = load(p, refOf(req));
    const b = req.body as { notes?: string | null; vehicle_id?: number; updated_at?: number };
    if (b.updated_at !== undefined) notFuture('/updated_at', b.updated_at);
    // Last writer wins on the client's edit time; ties go to the server (08 section 4.4).
    if (b.updated_at !== undefined && b.updated_at <= row.updatedAt) {
      return reply.header('X-MileWage-Applied', 'false').send(shiftView(row));
    }
    if (b.vehicle_id !== undefined) checkVehicle(p.userId, b.vehicle_id);
    const set: Partial<ShiftRow> = { updatedAt: b.updated_at ?? now(), ...touch(p) };
    if (b.notes !== undefined) set.notes = b.notes;
    if (b.vehicle_id !== undefined) set.vehicleId = b.vehicle_id;
    return reply
      .header('X-MileWage-Applied', 'true')
      .send(shiftView(shifts.update(row.id, set) ?? row));
  });

  // Minimal end: status and time only. Trips, totals and reconciliation arrive with the engine (M5.3).
  app.post('/shifts/:ref/end', { schema: { params: refParams, body: end } }, async (req) => {
    const p = auth(req, 'SD');
    const row = load(p, refOf(req), false);
    if (row.status !== 'active') return shiftView(row); // idempotent
    const { ended_at: endedAt } = req.body as { ended_at: number };
    notFuture('/ended_at', endedAt);
    if (endedAt < row.startedAt) throw invalid('/ended_at', 'must not be before the shift started');
    const saved = shifts.update(row.id, {
      status: 'ended',
      endedAt,
      updatedAt: endedAt,
      ...touch(p),
    });
    return shiftView(saved ?? row);
  });

  app.put(
    '/shifts/:ref/odometer/:kind',
    { schema: { params: kindParams, body: reading } },
    async (req, reply) => {
      const p = auth(req, 'SD');
      const { kind } = req.params as { kind: 'shift_start' | 'shift_end' };
      const row = load(p, refOf(req));
      const b = req.body as { reading_m: number; recorded_at: number };
      notFuture('/recorded_at', b.recorded_at);
      const view = (r: object) => snakeKeys(r, 'userId');
      const old = odometer.find(row.id, kind);
      if (old && b.recorded_at <= old.recordedAt)
        return reply.header('X-MileWage-Applied', 'false').send(view(old));
      const saved = odometer.set({
        userId: p.userId,
        vehicleId: row.vehicleId,
        shiftId: row.id,
        kind,
        readingM: b.reading_m,
        recordedAt: b.recorded_at,
      });
      if (device(p)) shifts.update(row.id, touch(p));
      return reply.header('X-MileWage-Applied', 'true').send(view(saved));
    },
  );
}
