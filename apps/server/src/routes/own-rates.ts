import type { FastifyInstance } from 'fastify';
import { createOwnRateRepository, type Db, type NewOwnRate, type OwnRateRow } from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { idParams, strictObject, type AuthFn } from './util';

const fields = {
  effective_from: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  cents_per_unit: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
  unit: { enum: ['km', 'mi'] },
  note: { type: ['string', 'null'], maxLength: 200 },
};
const createBody = strictObject(fields, ['effective_from', 'cents_per_unit', 'unit']);
const patchBody = strictObject(fields, [], { minProperties: 1 });

type Body = Partial<{
  effective_from: string | null;
  cents_per_unit: number;
  unit: 'km' | 'mi';
  note: string | null;
}>;

/** The `OwnMileageRate` object: amounts in minor units with hundredths (72.5 is 72.5 cents). */
export const ownRateView = (r: OwnRateRow) => ({
  id: r.id,
  effective_from: r.effectiveFrom,
  cents_per_unit: r.hundredths / 100,
  unit: r.unit,
  note: r.note,
});

const calendar = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
};
const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The mileage rate is not valid.', [{ path, message }]);

/**
 * Your mileage rates with their dates (ADR 0007). Each is in force from its date until the next;
 * `PATCH /settings` `use_own_mileage_rate` says whether they replace the country's rate. Web only.
 */
export function ownRateRoutes(
  app: FastifyInstance,
  { db, now, auth, emit }: { db: Db; now: () => number; auth: AuthFn; emit?: EventEmit },
) {
  const repo = createOwnRateRepository(db);
  // The deductions and the settings' rate of today change with the list.
  const changed = (userId: number) => emit?.('settings.updated', { userId: String(userId) });

  /** The row to store, checked: a real day, one rate per day, a note trimmed to null. */
  const rowOf = (userId: number, b: Body, current?: OwnRateRow): NewOwnRate => {
    const day =
      b.effective_from === undefined ? (current?.effectiveFrom ?? null) : b.effective_from;
    if (day !== null && !calendar(day)) throw invalid('/effective_from', 'is not a calendar date');
    if (repo.onDay(userId, day, current?.id)) {
      throw invalid(
        '/effective_from',
        day === null
          ? 'you already have a rate from the start'
          : 'you already have a rate from this day',
      );
    }
    const note = b.note === undefined ? (current?.note ?? null) : b.note?.trim() || null;
    return {
      effectiveFrom: day,
      // Hundredths of a minor unit: 72.5 cents per mile is kept exactly.
      hundredths:
        b.cents_per_unit === undefined
          ? current!.hundredths
          : Math.max(1, Math.round(b.cents_per_unit * 100)),
      unit: b.unit ?? current!.unit,
      note,
    };
  };
  const mine = (userId: number, id: number) => {
    const r = repo.find(userId, id);
    if (!r) throw new ProblemError('not_found', 'No such mileage rate.');
    return r;
  };

  app.get('/own-mileage-rates', async (req) => {
    const { userId } = auth(req, 'S');
    return repo.list(userId).map(ownRateView);
  });

  app.post('/own-mileage-rates', { schema: { body: createBody } }, async (req, reply) => {
    const { userId } = auth(req, 'S');
    const row = repo.create(userId, rowOf(userId, req.body as Body), now());
    changed(userId);
    return reply.status(201).send(ownRateView(row));
  });

  app.patch(
    '/own-mileage-rates/:id',
    { schema: { params: idParams, body: patchBody } },
    async (req) => {
      const { userId } = auth(req, 'S');
      const id = (req.params as { id: number }).id;
      const row = rowOf(userId, req.body as Body, mine(userId, id));
      const saved = repo.update(userId, id, row, now())!;
      changed(userId);
      return ownRateView(saved);
    },
  );

  app.delete('/own-mileage-rates/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { userId } = auth(req, 'S');
    const id = (req.params as { id: number }).id;
    mine(userId, id);
    repo.delete(userId, id);
    changed(userId);
    return reply.status(204).send();
  });
}
