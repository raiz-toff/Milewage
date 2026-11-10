import type { FastifyInstance } from 'fastify';
import {
  createOdometerRepository as odometerRepo,
  createProcessingRepository as processingRepo,
  createShiftRepository as shiftRepo,
  createVehicleRepository as vehicleRepo,
  type Db,
  type FlagRow,
  type ShiftRow,
  type TripRow,
} from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import type { ValuedShift } from '../mileage-deduction';
import type { ShiftPresenter } from '../processing/presenter';
import type { ShiftBook } from '../processing/shift-book';
import { refParam as ref, snakeKeys, str, strictObject, type AuthFn, type Principal } from './util';

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
const manifest = strictObject(
  {
    first_seq: { type: 'integer', minimum: 1 },
    last_seq: { type: 'integer', minimum: 1 },
    point_count: { type: 'integer', minimum: 0 },
  },
  ['first_seq', 'last_seq', 'point_count'],
);
const phoneResult = strictObject(
  {
    calc_version: { type: 'integer' },
    segmenter: { enum: ['stops', 'whole_shift'] },
    input_digest: { type: 'string', pattern: '^[0-9a-f]{16}$' },
    total_m: ms,
    active_m: ms,
    deadhead_m: ms,
    personal_m: ms,
    trips_count: ms,
  },
  [
    'calc_version',
    'segmenter',
    'input_digest',
    'total_m',
    'active_m',
    'deadhead_m',
    'personal_m',
    'trips_count',
  ],
);
const interruption = strictObject({ from_ms: ms, to_ms: ms }, ['from_ms', 'to_ms']);
const end = strictObject(
  {
    ended_at: ms,
    manifest,
    phone_result: phoneResult,
    interruptions: { type: 'array', maxItems: 200, items: interruption },
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

const flagView = (f: FlagRow) => ({
  code: f.code,
  severity: f.severity,
  detail: f.detail ? (JSON.parse(f.detail) as object) : null,
});
/** The `Shift` object. Phone-side columns stay out of it; `recon` has its own member. */
export const shiftView = (
  r: ShiftRow,
  flags: readonly FlagRow[] = [],
  deduction: ValuedShift = { cents: null, rate: null },
) => ({
  ...snakeKeys(
    r,
    'userId',
    'deviceTouchedAt',
    'phoneTotalM',
    'phoneCalcVersion',
    'inputDigest',
    'interruptionsJson',
  ),
  recon_reasons: r.reconReasons ? (JSON.parse(r.reconReasons) as string[]) : [],
  calc_mismatch: r.calcMismatch === 1,
  // Computed at read time by the mileage deduction, never stored.
  deduction_cents: deduction.cents,
  // Which rate valued it: the country's or your own (ADR 0007); null with no value.
  deduction_rate: deduction.rate,
  flags: flags.map(flagView),
});
/** The `Trip` object; the client UUID of a manual trip is not part of it. */
export const tripView = (t: TripRow) => snakeKeys(t, 'userId', 'clientId');
/** `recon` of `POST /shifts/{ref}/end`, rebuilt from the stored columns so a retry answers the same. */
const reconView = (r: ShiftRow) =>
  r.phoneTotalM === null || r.totalM === null || r.reconStatus === 'pending'
    ? undefined
    : {
        status: r.reconStatus,
        server_total_m: r.totalM,
        diff_m: r.totalM - r.phoneTotalM,
        reasons: r.reconReasons ? (JSON.parse(r.reconReasons) as string[]) : [],
      };
const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

/** The logbook's shift routes: start, read, list, edit notes or vehicle, odometer, a minimal end. */
export function shiftRoutes(
  app: FastifyInstance,
  {
    db,
    now,
    auth,
    present,
    book,
    emit = () => {},
  }: {
    db: Db;
    now: () => number;
    auth: AuthFn;
    present: ShiftPresenter;
    /** Records, recomputes and announces the shift; holds the read window. */
    book: ShiftBook;
    /** Publishes the overwrite log and odometer facts on the event bus (08 section 16.4). */
    emit?: EventEmit;
  },
) {
  const shifts = shiftRepo(db);
  const processing = processingRepo(db);
  /** One shift with its flags, the way every route returns it. */
  const view = (r: ShiftRow) => present.one(r);
  const odometer = odometerRepo(db);
  const vehicles = vehicleRepo(db);
  const load = (p: Principal, r: string, open = true) => book.find(p, r, { editable: open });
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
    if (same) return view(same); // idempotent: returned unchanged
    notFuture('/started_at', b.started_at);
    checkVehicle(p.userId, b.vehicle_id);
    const active = shifts.active(p.userId);
    if (active) {
      const extra = { active_shift: view(active) };
      throw new ProblemError(
        'shift_already_active',
        'Another shift is already active.',
        undefined,
        {},
        extra,
      );
    }
    const row = book.start(p, {
      clientId,
      vehicleId: b.vehicle_id,
      startedAt: b.started_at,
      segmenter: b.segmenter,
      notes: b.notes,
    });
    return reply.status(201).send(view(row));
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
    const rows = book.list(p, { ...q, vehicleId: q.vehicle_id, after, limit });
    const last = rows[limit - 1];
    const next = rows.length > limit && last ? [last.startedAt, last.id] : null;
    const page = rows.slice(0, limit);
    return {
      items: present.many(page),
      next_cursor: next && Buffer.from(JSON.stringify(next)).toString('base64url'),
    };
  });

  app.get('/shifts/:ref', { schema: { params: refParams } }, async (req) =>
    view(load(auth(req, 'SD'), refOf(req), false)),
  );

  app.get('/shifts/:ref/trips', { schema: { params: refParams } }, async (req) =>
    processing.tripsOf(load(auth(req, 'SD'), refOf(req), false).id).map(tripView),
  );

  app.patch('/shifts/:ref', { schema: { params: refParams, body: patch } }, async (req, reply) => {
    const p = auth(req, 'SD');
    const row = load(p, refOf(req));
    const b = req.body as { notes?: string | null; vehicle_id?: number; updated_at?: number };
    if (b.updated_at !== undefined) notFuture('/updated_at', b.updated_at);
    // Last writer wins on the client's edit time; ties go to the server (08 section 4.4).
    if (b.updated_at !== undefined && b.updated_at <= row.updatedAt) {
      return reply.header('X-MileWage-Applied', 'false').send(view(row));
    }
    if (b.vehicle_id !== undefined) checkVehicle(p.userId, b.vehicle_id);
    const set: Partial<ShiftRow> = { updatedAt: b.updated_at ?? now() };
    if (b.notes !== undefined) set.notes = b.notes;
    if (b.vehicle_id !== undefined) set.vehicleId = b.vehicle_id;
    // A value replaced by a newer edit is kept in the overwrite log (15 section 8.2).
    if (
      (set.notes !== undefined && set.notes !== row.notes) ||
      (set.vehicleId !== undefined && set.vehicleId !== row.vehicleId)
    ) {
      emit('edit.overwritten', {
        userId: String(p.userId),
        entity: 'shift',
        key: row.clientId,
        superseded: { notes: row.notes, vehicle_id: row.vehicleId, updated_at: row.updatedAt },
        ...(p.kind === 'device' ? { deviceId: String(p.deviceId) } : {}),
      });
    }
    const saved = book.edit(p, row, set);
    return reply.header('X-MileWage-Applied', 'true').send(view(saved));
  });

  // Finalize: the driver has reviewed the shift. From now on nothing recomputes or edits it (14 section 11).
  app.post('/shifts/:ref/finalize', { schema: { params: refParams } }, async (req) => {
    const p = auth(req, 'S');
    const row = load(p, refOf(req), false);
    if (row.status === 'finalized') return view(row); // idempotent
    if (row.status === 'active')
      throw new ProblemError('shift_not_ended', 'End the shift before finalizing it.');
    return view(book.finalize(row));
  });

  // Recalculate: the engine again on the stored points with the current algorithm (calc_version follows it).
  app.post('/shifts/:ref/recalculate', { schema: { params: refParams } }, async (req) => {
    const p = auth(req, 'S');
    const row = load(p, refOf(req)); // a finalized shift is 409 shift_finalized
    if (row.status === 'active')
      throw new ProblemError('shift_not_ended', 'End the shift before recalculating it.');
    return view(book.recompute(p, row, { cause: 'recalc' }));
  });

  const purgeQuery = strictObject({ confirm_recent: { type: 'boolean' } }, []);
  app.delete(
    '/shifts/:ref',
    { schema: { params: refParams, querystring: purgeQuery } },
    async (req, reply) => {
      const p = auth(req, 'S');
      const row = load(p, refOf(req), false);
      if (row.status === 'active')
        throw new ProblemError('shift_not_ended', 'End the shift before deleting it.');
      // The retention rules keep evidence for 7 years, so a younger shift needs a deliberate yes (07 section 4.2).
      const evidence = new Date(now());
      evidence.setUTCFullYear(evidence.getUTCFullYear() - 7);
      if (
        row.startedAt > evidence.getTime() &&
        (req.query as { confirm_recent?: boolean }).confirm_recent !== true
      ) {
        throw invalid('/confirm_recent', 'is required (true) to delete a shift under 7 years old');
      }
      book.purge(p, row);
      return reply.status(204).send();
    },
  );

  // End: status and time, then (tracking on) the shared engine on the stored points, one transaction.
  app.post('/shifts/:ref/end', { schema: { params: refParams, body: end } }, async (req) => {
    const p = auth(req, 'SD');
    const row = load(p, refOf(req), false);
    const recon = reconView(row);
    if (row.status !== 'active') return { ...view(row), ...(recon ? { recon } : {}) }; // idempotent
    const b = req.body as {
      ended_at: number;
      manifest?: { first_seq: number; last_seq: number; point_count: number };
      phone_result?: {
        calc_version: number;
        segmenter: 'stops' | 'whole_shift';
        input_digest: string;
        total_m: number;
        active_m: number;
        deadhead_m: number;
        personal_m: number;
        trips_count: number;
      };
      interruptions?: { from_ms: number; to_ms: number }[];
    };
    notFuture('/ended_at', b.ended_at);
    if (b.ended_at < row.startedAt)
      throw invalid('/ended_at', 'must not be before the shift started');
    if (b.manifest && b.manifest.first_seq > b.manifest.last_seq) {
      throw invalid('/manifest/first_seq', 'must not be after last_seq');
    }
    const phone = b.phone_result;
    const ended = book.end(p, row, {
      endedAt: b.ended_at,
      manifest: b.manifest && {
        firstSeq: b.manifest.first_seq,
        lastSeq: b.manifest.last_seq,
        pointCount: b.manifest.point_count,
      },
      result: phone && {
        calcVersion: phone.calc_version,
        segmenter: phone.segmenter,
        inputDigest: phone.input_digest,
        totalM: phone.total_m,
        activeM: phone.active_m,
        deadheadM: phone.deadhead_m,
        personalM: phone.personal_m,
        tripsCount: phone.trips_count,
      },
      interruptions: b.interruptions,
    });
    const sent = reconView(ended);
    return { ...view(ended), ...(sent ? { recon: sent } : {}) };
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
      book.touch(p, row);
      if (old && old.readingM !== saved.readingM) {
        emit('edit.overwritten', {
          userId: String(p.userId),
          entity: 'odometer',
          key: String(saved.id),
          superseded: { reading_m: old.readingM, recorded_at: old.recordedAt },
          ...(p.kind === 'device' ? { deviceId: String(p.deviceId) } : {}),
        });
      }
      emit('odometer.updated', { odometerId: String(saved.id), userId: String(p.userId) });
      return reply.header('X-MileWage-Applied', 'true').send(view(saved));
    },
  );
}
