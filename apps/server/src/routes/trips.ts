import type { FastifyInstance } from 'fastify';
import {
  createArchiveRepository,
  createProcessingRepository,
  createShiftRepository,
  type Db,
  type ShiftRow,
  type TripRow,
} from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { presentShift } from '../processing/presenter';
import type { ShiftProcessor } from '../processing/shift-processor';
import { tripView } from './shifts';
import { idParams, str, strictObject, type AuthFn, type Principal } from './util';

const DAY = 24 * 60 * 60 * 1000;
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ref = { type: 'string', pattern: `^([0-9]+|${UUID})$` };
const ms = { type: 'integer', minimum: 0 };
const kind = { enum: ['active', 'deadhead', 'personal'] };
const purpose = str(1, 200);

const patchBody = strictObject({ kind, purpose }, [], { minProperties: 1 });
const manualBody = strictObject(
  {
    kind,
    started_at: ms,
    ended_at: ms,
    distance_m: { type: 'integer', minimum: 1 },
    purpose,
    edited_at: ms,
  },
  ['kind', 'started_at', 'ended_at', 'distance_m', 'purpose', 'edited_at'],
);
const overrideBody = strictObject({ kind, purpose, edited_at: ms }, [
  'kind',
  'purpose',
  'edited_at',
]);

type Kind = TripRow['kind'];
const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

export interface TripRouteDeps {
  db: Db;
  now: () => number;
  auth: AuthFn;
  processor: ShiftProcessor;
  emit: EventEmit;
  trackingOn: () => boolean;
}

/** What every trip edit shares: find the shift, refuse a finalized one, recompute, announce. */
function tripEdits({ db, now, processor, emit, trackingOn }: TripRouteDeps) {
  const shifts = createShiftRepository(db);
  const repo = createProcessingRepository(db);
  const archiveRepo = createArchiveRepository(db);
  const since = (p: Principal) => (p.kind === 'device' ? now() - 14 * DAY : undefined);
  const archived = (row: ShiftRow) => archiveRepo.hasArchive(row.id);
  const touch = (p: Principal): Partial<ShiftRow> =>
    p.kind === 'device' ? { deviceTouchedAt: now() } : {};
  const shiftOf = (p: Principal, r: string) => {
    const row = shifts.byRef(p.userId, r, since(p));
    if (!row) throw new ProblemError('shift_not_found', 'No such shift.');
    return row;
  };
  const open = (row: ShiftRow) => {
    if (row.status === 'finalized')
      throw new ProblemError('shift_finalized', 'This shift is finalized.');
    return row;
  };
  /** Totals follow the edit. An active shift is computed at its end, so nothing runs yet. */
  const recompute = (p: Principal, row: ShiftRow) => {
    if (row.status === 'active') return row;
    const done = trackingOn() && !archived(row) ? processor.run(row).shift : processor.retotal(row);
    const mark = touch(p);
    return (p.kind === 'device' && shifts.update(done.id, mark)) || done;
  };
  const announce = (row: ShiftRow, tripId?: number, extra: object = {}) => {
    if (tripId !== undefined) {
      emit('trip.updated', { shiftId: String(row.id), tripId: String(tripId), ...extra });
    }
    emit('shift.updated', { shiftId: String(row.id) });
  };
  const device = (p: Principal) => (p.kind === 'device' ? String(p.deviceId) : undefined);
  const notFuture = (path: string, at: number) => {
    if (at > now() + 5 * 60 * 1000)
      throw invalid(path, 'must not be more than 5 minutes in the future');
  };
  return {
    processor,
    shifts,
    repo,
    since,
    touch,
    shiftOf,
    open,
    recompute,
    announce,
    device,
    notFuture,
  };
}

/** Core: reclassify or re-describe a trip, add or delete a manual trip (08 section 3, 07 section 3 rule 8). */
export function tripRoutes(app: FastifyInstance, deps: TripRouteDeps) {
  const { auth, db, now, emit, trackingOn } = deps;
  const t = tripEdits(deps);
  const result = (shift: ShiftRow, trip: TripRow | undefined) => ({
    trip: trip ? tripView(trip) : null,
    shift: presentShift(db, shift),
  });

  app.patch('/trips/:id', { schema: { params: idParams, body: patchBody } }, async (req) => {
    const p = auth(req, 'SD');
    const trip = t.repo.tripById(p.userId, (req.params as { id: number }).id);
    const shift = trip && t.shifts.byId(trip.shiftId);
    if (
      !trip ||
      !shift ||
      (p.kind === 'device' && !t.shifts.byRef(p.userId, String(shift.id), t.since(p)))
    )
      throw new ProblemError('not_found', 'No such trip.');
    t.open(shift);
    const b = req.body as { kind?: Kind; purpose?: string };
    const at = now();
    if (trip.source === 'manual') {
      t.repo.updateTrip(trip.id, {
        kind: b.kind ?? trip.kind,
        purpose: b.purpose ?? trip.purpose,
        editedAt: at,
      });
    } else {
      // Stored apart from the derived trip so a recompute cannot erase it (07 section 2.7).
      t.processor.assertRecomputable(shift);
      if (!trackingOn())
        throw new ProblemError(
          'trip_not_editable',
          'Automatic trips can be edited only while tracking is on.',
        );
      const old = t.repo.findOverride(shift.id, trip.tripKey);
      if (old) {
        emit('edit.overwritten', {
          userId: String(p.userId),
          entity: 'trip_override',
          key: trip.tripKey,
          superseded: { kind: old.kind, purpose: old.purpose, edited_at: old.editedAt },
          deviceId: t.device(p),
        });
      }
      t.repo.putOverride({
        userId: p.userId,
        shiftId: shift.id,
        tripKey: trip.tripKey,
        kind: b.kind ?? trip.kind,
        purpose: b.purpose ?? trip.purpose,
        editedAt: Math.max(at, (old?.editedAt ?? 0) + 1),
        deviceId: p.kind === 'device' ? p.deviceId : null,
      });
    }
    const saved = t.recompute(p, shift);
    t.announce(shift, trip.id);
    return result(saved, t.repo.tripById(p.userId, trip.id));
  });

  app.delete('/trips/:id', { schema: { params: idParams } }, async (req, reply) => {
    const p = auth(req, 'S');
    const trip = t.repo.tripById(p.userId, (req.params as { id: number }).id);
    const shift = trip && t.shifts.byId(trip.shiftId);
    if (!trip || !shift) throw new ProblemError('not_found', 'No such trip.');
    t.open(shift);
    if (trip.source !== 'manual')
      throw new ProblemError('trip_not_editable', 'Only manual trips can be deleted.');
    t.repo.deleteTrip(trip.id);
    t.recompute(p, shift);
    t.announce(shift, trip.id, { tripKey: trip.tripKey, deleted: true });
    return reply.status(204).send();
  });

  const manualParams = strictObject({ ref, client_id: { type: 'string', format: 'uuid' } }, [
    'ref',
    'client_id',
  ]);
  app.put(
    '/shifts/:ref/trips/:client_id',
    { schema: { params: manualParams, body: manualBody } },
    async (req, reply) => {
      const p = auth(req, 'SD');
      const params = req.params as { ref: string; client_id: string };
      const shift = t.open(t.shiftOf(p, params.ref));
      const clientId = params.client_id.toLowerCase();
      const b = req.body as {
        kind: Kind;
        started_at: number;
        ended_at: number;
        distance_m: number;
        purpose: string;
        edited_at: number;
      };
      if (b.ended_at < b.started_at) throw invalid('/ended_at', 'must not be before started_at');
      t.notFuture('/ended_at', b.ended_at);
      t.notFuture('/edited_at', b.edited_at);
      const old = t.repo.tripByKey(p.userId, clientId);
      if (old && (old.source !== 'manual' || old.shiftId !== shift.id))
        throw new ProblemError('trip_not_editable', 'That id belongs to another trip.');
      // Last writer wins on the client's edit time; ties go to the server (08 section 4.4).
      if (old && b.edited_at <= (old.editedAt ?? 0)) {
        return reply.header('X-MileWage-Applied', 'false').send(result(shift, old));
      }
      if (old) {
        emit('edit.overwritten', {
          userId: String(p.userId),
          entity: 'trip',
          key: clientId,
          superseded: tripView(old),
          deviceId: t.device(p),
        });
      }
      const row = {
        kind: b.kind,
        startedAt: b.started_at,
        endedAt: b.ended_at,
        distanceM: b.distance_m,
        purpose: b.purpose,
        editedAt: b.edited_at,
      };
      const saved = old
        ? t.repo.updateTrip(old.id, row)
        : t.repo.insertTrip({
            ...row,
            userId: p.userId,
            shiftId: shift.id,
            tripKey: clientId,
            clientId,
            originalKind: b.kind === 'personal' ? 'active' : b.kind,
            source: 'manual',
            startLatE7: null,
            startLonE7: null,
            endLatE7: null,
            endLonE7: null,
          });
      const updated = t.recompute(p, shift);
      t.announce(shift, saved?.id);
      return reply.header('X-MileWage-Applied', 'true').send(result(updated, saved));
    },
  );
}

/** Tracking: the idempotent override of an auto trip by its deterministic key (14 section 6.4). */
export function overrideRoutes(app: FastifyInstance, deps: TripRouteDeps) {
  const { auth, db, emit } = deps;
  const t = tripEdits(deps);
  const params = strictObject({ ref, trip_key: { type: 'string', minLength: 1, maxLength: 200 } }, [
    'ref',
    'trip_key',
  ]);
  app.put(
    '/shifts/:ref/trip-overrides/:trip_key',
    { schema: { params, body: overrideBody } },
    async (req, reply) => {
      const p = auth(req, 'SD');
      const path = req.params as { ref: string; trip_key: string };
      const shift = t.open(t.shiftOf(p, path.ref));
      t.processor.assertRecomputable(shift);
      const key = path.trip_key;
      const b = req.body as { kind: Kind; purpose: string; edited_at: number };
      t.notFuture('/edited_at', b.edited_at);
      const current = () => t.repo.tripByKey(p.userId, key);
      const old = t.repo.findOverride(shift.id, key);
      const out = (row: ShiftRow) => ({
        trip: ((x) => (x?.shiftId === shift.id ? tripView(x) : null))(current()),
        shift: presentShift(db, row),
      });
      if (old && b.edited_at <= old.editedAt) {
        return reply.header('X-MileWage-Applied', 'false').send(out(shift));
      }
      if (old) {
        emit('edit.overwritten', {
          userId: String(p.userId),
          entity: 'trip_override',
          key,
          superseded: { kind: old.kind, purpose: old.purpose, edited_at: old.editedAt },
          deviceId: t.device(p),
        });
      }
      t.repo.putOverride({
        userId: p.userId,
        shiftId: shift.id,
        tripKey: key,
        kind: b.kind,
        purpose: b.purpose,
        editedAt: b.edited_at,
        deviceId: p.kind === 'device' ? p.deviceId : null,
      });
      // An override whose trip does not exist is kept and reported as `override_orphaned` by the run.
      const updated = t.recompute(p, shift);
      t.announce(updated);
      return reply.header('X-MileWage-Applied', 'true').send(out(updated));
    },
  );
}
