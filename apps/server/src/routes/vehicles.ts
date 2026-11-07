import type { FastifyInstance } from 'fastify';
import { createSettingsRepository, createVehicleRepository, type Db, type VehicleRow } from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { idParams, str, strictObject, type AuthFn } from './util';

const kind = { enum: ['car', 'motorcycle', 'van', 'bicycle', 'ebike', 'scooter', 'walking'] };
const details = {
  make: { type: ['string', 'null'], maxLength: 64 },
  model: { type: ['string', 'null'], maxLength: 64 },
  year: { type: ['integer', 'null'], minimum: 1900, maximum: 2100 },
  plate: { type: ['string', 'null'], maxLength: 16 },
  power: { enum: ['gas', 'hybrid', 'ev', 'other', null] },
  ownership: { enum: ['owned', 'financed', 'leased', 'rented'] },
};
const create = strictObject({ name: str(1, 64), kind, ...details }, ['name', 'kind']);
const update = strictObject(
  { name: str(1, 64), kind, archived: { type: 'boolean' }, ...details },
  [],
  { minProperties: 1 },
);
const query = strictObject({ include_archived: { type: 'boolean' } }, []);
export const vehicleView = (v: VehicleRow) => ({
  id: v.id,
  name: v.name,
  kind: v.kind,
  make: v.make,
  model: v.model,
  year: v.year,
  plate: v.plate,
  power: v.power,
  ownership: v.ownership,
  created_at: v.createdAt,
  archived_at: v.archivedAt,
});

/** Vehicles are archived, never deleted (07 section 2.2). */
export function vehicleRoutes(
  app: FastifyInstance,
  { db, now, auth, emit = () => {} }: { db: Db; now: () => number; auth: AuthFn; emit?: EventEmit },
) {
  const repo = createVehicleRepository(db);

  app.get('/vehicles', { schema: { querystring: query } }, async (req) => {
    const all = (req.query as { include_archived?: boolean }).include_archived === true;
    return repo.list(auth(req, 'SD').userId, all).map(vehicleView);
  });

  app.post('/vehicles', { schema: { body: create } }, async (req, reply) => {
    const b = req.body as Partial<VehicleRow> & { name: string; kind: VehicleRow['kind'] };
    const row = repo.create({ ...b, userId: auth(req, 'S').userId, createdAt: now() });
    emit('vehicle.updated', { vehicleId: String(row.id) });
    return reply.status(201).send(vehicleView(row));
  });

  app.patch('/vehicles/:id', { schema: { params: idParams, body: update } }, async (req) => {
    const { userId } = auth(req, 'S');
    const { id } = req.params as { id: number };
    const { archived, ...b } = req.body as Partial<VehicleRow> & { archived?: boolean };
    const current = repo.find(userId, id);
    if (!current) throw new ProblemError('not_found', 'No such vehicle.');
    const archivedAt =
      archived === undefined ? {} : { archivedAt: archived ? (current.archivedAt ?? now()) : null };
    const saved = repo.update(userId, id, { ...b, ...archivedAt }) ?? current;
    // An archived vehicle cannot stay the one preselected for a new shift.
    const prefs = createSettingsRepository(db);
    if (saved.archivedAt !== null && prefs.get(userId)?.defaultVehicleId === id) {
      prefs.update(userId, { defaultVehicleId: null, updatedAt: now() });
      emit('settings.updated', { userId: String(userId) });
    }
    emit('vehicle.updated', { vehicleId: String(id) });
    return vehicleView(saved);
  });
}
