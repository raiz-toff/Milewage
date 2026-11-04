import type { FastifyInstance } from 'fastify';
import {
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

/** The logbook's shift routes: start, read and list. Edits, odometer and the minimal end follow. */
export function shiftRoutes(
  app: FastifyInstance,
  { db, now, auth }: { db: Db; now: () => number; auth: AuthFn },
) {
  const shifts = shiftRepo(db);
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
}
