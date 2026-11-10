import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createPlaceRepository,
  createShiftRepository,
  type Db,
  type NewPlace,
  type PlaceRow,
} from '../db';
import type { DriverContexts } from '../driver-context';
import { ProblemError } from '../errors';
import { boxAround, inside, PLACE_RADIUS } from '../processing/places';
import type { ShiftBook } from '../processing/shift-book';
import { idParams, strictObject, type SessionPrincipal } from './util';

/** More would be a list nobody manages; the limit keeps every engine run's matching cheap. */
export const MAX_PLACES = 1000;

const fields = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  lat_e7: { type: 'integer', minimum: -900_000_000, maximum: 900_000_000 },
  lon_e7: { type: 'integer', minimum: -1_800_000_000, maximum: 1_800_000_000 },
  radius_m: { type: 'integer', minimum: PLACE_RADIUS.min, maximum: PLACE_RADIUS.max },
  role: { enum: ['pickup', 'dropoff', 'other'] },
};
const createBody = strictObject(fields, ['name', 'lat_e7', 'lon_e7', 'role']);
const patchBody = strictObject(fields, [], { minProperties: 1 });

type Body = Partial<{
  name: string;
  lat_e7: number;
  lon_e7: number;
  radius_m: number;
  role: PlaceRow['role'];
}>;

/** The `Place` object. */
export const placeView = (p: PlaceRow) => ({
  id: p.id,
  name: p.name,
  lat_e7: p.latE7,
  lon_e7: p.lonE7,
  radius_m: p.radiusM,
  role: p.role,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The place is not valid.', [{ path, message }]);

/**
 * Named places (ADR 0008), web session only, and only while stop detection is on (the same 404 as
 * the stops routes). A place labels the stops inside it; adding, changing or deleting one works out
 * again every ended shift with a stop inside the old or the new circle, exactly as a stop label
 * does. Finalized shifts, and shifts whose raw points were archived, keep their figures.
 */
export function placesRoutes({
  db,
  now,
  authn,
  drivers,
  book,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  drivers: DriverContexts;
  book: ShiftBook;
}) {
  return ({ app }: ServerRouteHost) => {
    const repo = createPlaceRepository(db);
    const shifts = createShiftRepository(db);

    const open = (req: Parameters<typeof authn.authenticate>[0]): SessionPrincipal => {
      const p = authn.authenticate(req, 'S');
      if (!drivers.of(p.userId).stopsOn) {
        throw new ProblemError('not_found', 'Stops are turned off.');
      }
      return p;
    };
    const mine = (userId: number, id: number) => {
      const row = repo.find(userId, id);
      if (!row) throw new ProblemError('not_found', 'No such place.');
      return row;
    };
    const rowOf = (b: Body, current?: PlaceRow): NewPlace => {
      const name = b.name === undefined ? current!.name : b.name.trim();
      if (name === '') throw invalid('/name', 'must not be blank');
      return {
        name,
        latE7: b.lat_e7 ?? current!.latE7,
        lonE7: b.lon_e7 ?? current!.lonE7,
        radiusM: b.radius_m ?? current?.radiusM ?? PLACE_RADIUS.default,
        role: b.role ?? current!.role,
      };
    };

    /** Shifts with a stop inside any of the circles, or carrying the place now; by id, with status. */
    const touched = (userId: number, circles: NewPlace[], placeId?: number) => {
      const out = new Map<number, 'ended' | 'finalized'>();
      for (const c of circles) {
        for (const s of repo.stopsInBox(userId, boxAround(c, c.radiusM))) {
          if (inside(c, c.radiusM, s)) out.set(s.shiftId, s.status);
        }
      }
      if (placeId !== undefined) {
        for (const s of repo.shiftsMatching(userId, placeId)) out.set(s.shiftId, s.status);
      }
      return out;
    };
    /** Works out again what a place change touches, as a label change does; counts what was kept. */
    const reevaluate = (p: SessionPrincipal, ids: Map<number, 'ended' | 'finalized'>) => {
      let recalculated = 0;
      let kept = 0;
      for (const id of [...ids.keys()].sort((a, b) => a - b)) {
        const row = shifts.byId(id);
        if (!row || row.status !== 'ended') {
          if (row?.status === 'finalized') kept++;
          continue;
        }
        try {
          book.needsEngine(row); // raw points archived: the stored figures are all there is
        } catch (e) {
          if (e instanceof ProblemError && e.code === 'not_recomputable') {
            kept++;
            continue;
          }
          throw e;
        }
        book.recompute(p, row, { cause: 'label' });
        recalculated++;
      }
      return { shifts_recalculated: recalculated, shifts_kept: kept };
    };

    app.get('/places', async (req) => {
      const p = open(req);
      return repo.list(p.userId).map(placeView);
    });

    app.post('/places', { schema: { body: createBody } }, async (req, reply) => {
      const p = open(req);
      if (repo.count(p.userId) >= MAX_PLACES) {
        throw invalid('/', `you can keep up to ${MAX_PLACES} places`);
      }
      const row = repo.create(p.userId, rowOf(req.body as Body), now());
      const counts = reevaluate(p, touched(p.userId, [row]));
      return reply.status(201).send({ place: placeView(row), ...counts });
    });

    app.patch('/places/:id', { schema: { params: idParams, body: patchBody } }, async (req) => {
      const p = open(req);
      const id = (req.params as { id: number }).id;
      const old = mine(p.userId, id);
      const next = rowOf(req.body as Body, old);
      const ids = touched(p.userId, [old, next], id);
      const saved = repo.update(p.userId, id, next, now())!;
      return { place: placeView(saved), ...reevaluate(p, ids) };
    });

    app.delete('/places/:id', { schema: { params: idParams } }, async (req) => {
      const p = open(req);
      const id = (req.params as { id: number }).id;
      const old = mine(p.userId, id);
      // Found before the delete: the stops lose their link to the place with it.
      const ids = touched(p.userId, [old], id);
      repo.delete(p.userId, id);
      return { place: null, ...reevaluate(p, ids) };
    });
  };
}
