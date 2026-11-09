import type { FastifyInstance } from 'fastify';
import {
  createProcessingRepository,
  createShiftRepository,
  type Db,
  type ShiftRow,
  type TripRow,
} from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import type { ShiftPresenter } from '../processing/presenter';
import type { ShiftBook } from '../processing/shift-book';
import { tripView } from './shifts';
import { idParams, refParam as ref, str, strictObject, type AuthFn, type Principal } from './util';

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
  present: ShiftPresenter;
  /** Records the change's recomputation and announces it. */
  book: ShiftBook;
  /** For the overwrite log. */
  emit: EventEmit;
  trackingOn: () => boolean;
}

/** What every trip edit shares: the trip and its shift as the principal may see them, open for edits. */
function tripEdits({ db, now, book }: TripRouteDeps) {
  const shifts = createShiftRepository(db);
  const repo = createProcessingRepository(db);
  /** A trip by id; its shift must be in the principal's read window and not finalized. */
  const tripOf = (p: Principal, id: number) => {
    const trip = repo.tripById(p.userId, id);
    const shift = trip && shifts.byRef(p.userId, String(trip.shiftId), book.since(p));
    if (!trip || !shift) throw new ProblemError('not_found', 'No such trip.');
    return { trip, shift: book.find(p, String(shift.id), { editable: true }) };
  };
  const device = (p: Principal) => (p.kind === 'device' ? String(p.deviceId) : undefined);
  const notFuture = (path: string, at: number) => {
    if (at > now() + 5 * 60 * 1000)
      throw invalid(path, 'must not be more than 5 minutes in the future');
  };
  return { repo, tripOf, device, notFuture };
}

/** Core: reclassify or re-describe a trip, add or delete a manual trip (08 section 3, 07 section 3 rule 8). */
export function tripRoutes(app: FastifyInstance, deps: TripRouteDeps) {
  const { auth, now, emit, trackingOn, present, book } = deps;
  const t = tripEdits(deps);
  const result = (shift: ShiftRow, trip: TripRow | undefined) => ({
    trip: trip ? tripView(trip) : null,
    shift: present.one(shift),
  });

  app.patch('/trips/:id', { schema: { params: idParams, body: patchBody } }, async (req) => {
    const p = auth(req, 'SD');
    const { trip, shift } = t.tripOf(p, (req.params as { id: number }).id);
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
      book.needsEngine(shift);
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
    const saved = book.recompute(p, shift, { cause: 'trip', tripId: trip.id });
    return result(saved, t.repo.tripById(p.userId, trip.id));
  });

  app.delete('/trips/:id', { schema: { params: idParams } }, async (req, reply) => {
    const p = auth(req, 'S');
    const { trip, shift } = t.tripOf(p, (req.params as { id: number }).id);
    if (trip.source !== 'manual')
      throw new ProblemError('trip_not_editable', 'Only manual trips can be deleted.');
    t.repo.deleteTrip(trip.id);
    book.recompute(p, shift, {
      cause: 'trip',
      tripId: trip.id,
      tripKey: trip.tripKey,
      deleted: true,
    });
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
      const shift = book.find(p, params.ref, { editable: true });
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
      const updated = book.recompute(p, shift, { cause: 'trip', tripId: saved?.id });
      return reply.header('X-MileWage-Applied', 'true').send(result(updated, saved));
    },
  );
}

/** Tracking: the idempotent override of an auto trip by its deterministic key (14 section 6.4). */
export function overrideRoutes(app: FastifyInstance, deps: TripRouteDeps) {
  const { auth, emit, present, book } = deps;
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
      const shift = book.find(p, path.ref, { editable: true });
      book.needsEngine(shift);
      const key = path.trip_key;
      const b = req.body as { kind: Kind; purpose: string; edited_at: number };
      t.notFuture('/edited_at', b.edited_at);
      const current = () => t.repo.tripByKey(p.userId, key);
      const old = t.repo.findOverride(shift.id, key);
      const out = (row: ShiftRow) => ({
        trip: ((x) => (x?.shiftId === shift.id ? tripView(x) : null))(current()),
        shift: present.one(row),
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
      const updated = book.recompute(p, shift, { cause: 'override' });
      return reply.header('X-MileWage-Applied', 'true').send(out(updated));
    },
  );
}
