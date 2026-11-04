import type { FastifyInstance } from 'fastify';
import { createVehicleRepository, type Db, type VehicleRow } from '../db';
import { ProblemError } from '../errors';
import { idParams, str, strictObject, type AuthFn } from './util';

const kind = { enum: ['car', 'motorcycle', 'van', 'bicycle'] };
const create = strictObject({ name: str(1, 64), kind }, ['name', 'kind']);
const update = strictObject({ name: str(1, 64), kind, archived: { type: 'boolean' } }, [], {
  minProperties: 1,
});
const query = strictObject({ include_archived: { type: 'boolean' } }, []);
const view = (v: VehicleRow) => ({
  id: v.id,
  name: v.name,
  kind: v.kind,
  created_at: v.createdAt,
  archived_at: v.archivedAt,
});

/** Vehicles are archived, never deleted (07 section 2.2). */
export function vehicleRoutes(
  app: FastifyInstance,
  { db, now, auth }: { db: Db; now: () => number; auth: AuthFn },
) {
  const repo = createVehicleRepository(db);

  app.get('/vehicles', { schema: { querystring: query } }, async (req) => {
    const all = (req.query as { include_archived?: boolean }).include_archived === true;
    return repo.list(auth(req, 'SD').userId, all).map(view);
  });

  app.post('/vehicles', { schema: { body: create } }, async (req, reply) => {
    const b = req.body as { name: string; kind: VehicleRow['kind'] };
    const row = repo.create({ ...b, userId: auth(req, 'S').userId, createdAt: now() });
    return reply.status(201).send(view(row));
  });

  app.patch('/vehicles/:id', { schema: { params: idParams, body: update } }, async (req) => {
    const { userId } = auth(req, 'S');
    const { id } = req.params as { id: number };
    const { archived, ...b } = req.body as Partial<VehicleRow> & { archived?: boolean };
    const current = repo.find(userId, id);
    if (!current) throw new ProblemError('not_found', 'No such vehicle.');
    const archivedAt =
      archived === undefined ? {} : { archivedAt: archived ? (current.archivedAt ?? now()) : null };
    return view(repo.update(userId, id, { ...b, ...archivedAt }) ?? current);
  });
}
