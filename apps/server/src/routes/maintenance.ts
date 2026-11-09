import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createExpenseRepository, createVehicleRepository, type Db } from '../db';
import { ProblemError } from '../errors';
import type { MileageDeduction } from '../mileage-deduction';
import { idParams, strictObject } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const fields = {
  kind: { enum: ['oil_change', 'tires', 'brakes', 'other'] },
  serviced_on: date,
  odometer_m: { type: ['integer', 'null'], minimum: 0 },
  cost_cents: { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 },
  notes: { type: ['string', 'null'], maxLength: 2000 },
};
const createBody = strictObject({ ...fields, record_expense: { type: 'boolean' } }, [
  'kind',
  'serviced_on',
]);
const patchBody = strictObject(fields, [], { minProperties: 1 });
const vehicleParams = idParams;

interface Row {
  id: number;
  vehicleId: number;
  kind: string;
  servicedOn: string;
  odometerM: number | null;
  costCents: number | null;
  expenseId: number | null;
  notes: string | null;
  createdAt: number;
}
const COLUMNS =
  'id, vehicle_id AS vehicleId, kind, serviced_on AS servicedOn, odometer_m AS odometerM, cost_cents AS costCents, expense_id AS expenseId, notes, created_at AS createdAt';

/** Module `maintenance` (18 section 6). With `expenses` on, a cost becomes a maintenance expense linked to the log. */
export function maintenanceRoutes({
  db,
  now,
  authn,
  deduction,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  deduction: MileageDeduction;
}) {
  return ({ app, registry }: ServerRouteHost) => {
    const vehicles = createVehicleRepository(db);
    const expenses = createExpenseRepository(db);
    const log = (userId: number, id: number) =>
      db
        .prepare(`SELECT ${COLUMNS} FROM maintenance_logs WHERE user_id = ? AND id = ?`)
        .get(userId, id) as Row | undefined;
    const need = (userId: number, id: number) => {
      const r = log(userId, id);
      if (!r) throw new ProblemError('not_found', 'No such maintenance entry.');
      return r;
    };
    const view = (userId: number, r: Row) => {
      const e =
        r.expenseId === null || !registry.isEnabled('expenses')
          ? undefined
          : expenses.find(userId, r.expenseId);
      return {
        id: r.id,
        vehicle_id: r.vehicleId,
        kind: r.kind,
        serviced_on: r.servicedOn,
        odometer_m: r.odometerM,
        // The cost of a linked entry is read from its expense.
        cost_cents: e ? e.amountCents : r.costCents,
        expense_id: r.expenseId,
        double_counts: e ? deduction.doubleCounts(userId, e) : false,
        notes: r.notes,
        created_at: r.createdAt,
      };
    };
    const ownVehicle = (userId: number, id: number) => {
      if (!vehicles.find(userId, id)) throw new ProblemError('not_found', 'No such vehicle.');
    };

    app.get('/vehicles/:id/maintenance', { schema: { params: vehicleParams } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      ownVehicle(userId, id);
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM maintenance_logs WHERE user_id = ? AND vehicle_id = ? ORDER BY serviced_on DESC, id DESC`,
        )
        .all(userId, id) as Row[];
      return rows.map((r) => view(userId, r));
    });

    app.post(
      '/vehicles/:id/maintenance',
      { schema: { params: vehicleParams, body: createBody } },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const vehicleId = (req.params as { id: number }).id;
        ownVehicle(userId, vehicleId);
        const b = req.body as {
          kind: string;
          serviced_on: string;
          odometer_m?: number | null;
          cost_cents?: number | null;
          notes?: string | null;
          record_expense?: boolean;
        };
        const cost = b.cost_cents ?? null;
        const record =
          (b.record_expense ?? true) && registry.isEnabled('expenses') && cost !== null && cost > 0;
        const id = db.transaction(() => {
          let expenseId: number | null = null;
          if (record) {
            expenseId = expenses.create(
              {
                userId,
                spentOn: b.serviced_on,
                category: 'maintenance',
                amountCents: cost!,
                merchant: '',
                deductible: 1,
                businessPct: 100,
                taxCreditCents: 0,
                vehicleId,
                shiftId: null,
                notes: `Service: ${b.kind.replace('_', ' ')}`,
                recurrence: null,
                nextDue: null,
                snoozedUntil: null,
                templateId: null,
              },
              now(),
            ).id;
          }
          return Number(
            db
              .prepare(
                `INSERT INTO maintenance_logs (user_id, vehicle_id, kind, serviced_on, odometer_m, cost_cents, expense_id, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                userId,
                vehicleId,
                b.kind,
                b.serviced_on,
                b.odometer_m ?? null,
                expenseId === null ? cost : null,
                expenseId,
                b.notes ?? null,
                now(),
              ).lastInsertRowid,
          );
        })();
        return reply.status(201).send(view(userId, need(userId, id)));
      },
    );

    app.patch(
      '/maintenance/:id',
      { schema: { params: idParams, body: patchBody } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        const cur = need(userId, id);
        const b = req.body as Partial<{
          kind: string;
          serviced_on: string;
          odometer_m: number | null;
          cost_cents: number | null;
          notes: string | null;
        }>;
        db.transaction(() => {
          if (b.cost_cents !== undefined) {
            if (cur.expenseId !== null && registry.isEnabled('expenses')) {
              if (b.cost_cents === null || b.cost_cents === 0) {
                throw new ProblemError('validation_failed', 'The entry is not valid.', [
                  {
                    path: '/cost_cents',
                    message: 'the linked expense needs an amount; delete the expense instead',
                  },
                ]);
              }
              expenses.update(userId, cur.expenseId, { amountCents: b.cost_cents }, now());
            } else {
              db.prepare('UPDATE maintenance_logs SET cost_cents = ? WHERE id = ?').run(
                b.cost_cents,
                id,
              );
            }
          }
          const map: Record<string, string> = {
            kind: 'kind',
            serviced_on: 'serviced_on',
            odometer_m: 'odometer_m',
            notes: 'notes',
          };
          for (const [k, col] of Object.entries(map)) {
            if (k in b)
              db.prepare(`UPDATE maintenance_logs SET ${col} = ? WHERE id = ?`).run(
                (b as Record<string, unknown>)[k],
                id,
              );
          }
          if (b.serviced_on && cur.expenseId !== null && registry.isEnabled('expenses')) {
            expenses.update(userId, cur.expenseId, { spentOn: b.serviced_on }, now());
          }
        })();
        return view(userId, need(userId, id));
      },
    );

    app.delete('/maintenance/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      const r = need(userId, id);
      // The linked expense is a tax record and stays; it keeps its amount.
      db.prepare('DELETE FROM maintenance_logs WHERE id = ?').run(r.id);
      return reply.status(204).send();
    });
  };
}
