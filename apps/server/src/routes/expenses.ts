import { EXPENSE_CATEGORIES, expenseCategory, type RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createExpenseRepository,
  createSettingsRepository,
  createShiftRepository,
  createVehicleRepository,
  type Db,
  type ExpenseRow,
  type NewExpense,
} from '../db';
import { deductibleCents, doubleCounts as doubleCountsOf } from '../expense-math';
import { ProblemError } from '../errors';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { receiptsDirOf } from '../receipts/store';
import { addInterval, localDate } from '../time';
import { idParams, str, strictObject } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const fields = {
  spent_on: date,
  category: str(1, 40),
  amount_cents: { type: 'integer', minimum: 1, maximum: 1_000_000_000 },
  merchant: { type: 'string', maxLength: 120 },
  deductible: { type: 'boolean' },
  business_pct: { type: 'integer', minimum: 0, maximum: 100 },
  tax_credit_cents: { type: 'integer', minimum: 0 },
  vehicle_id: { type: ['integer', 'null'], minimum: 1 },
  shift_id: { type: ['integer', 'null'], minimum: 1 },
  notes: { type: ['string', 'null'], maxLength: 2000 },
  recurrence: { enum: ['weekly', 'monthly', 'yearly', null] },
  next_due: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
};
const createBody = strictObject(fields, ['spent_on', 'category', 'amount_cents']);
const patchBody = strictObject(fields, [], { minProperties: 1 });
const listQuery = strictObject(
  {
    from: date,
    to: date,
    category: str(1, 40),
    deductible: { type: 'boolean' },
    vehicle_id: { type: 'integer', minimum: 1 },
    templates: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    cursor: str(1, 200),
  },
  [],
);
const occurrenceBody = strictObject({ spent_on: date, amount_cents: fields.amount_cents }, [
  'spent_on',
]);
const snoozeBody = strictObject({ until: date }, ['until']);

const calendar = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
};
const invalid = (path: string, message: string) =>
  new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

/** Module `expenses` (18 section 5). */
export function expensesRoutes({
  db,
  now,
  authn,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
}) {
  return (host: RouteHost) => {
    const { app, bus } = host as ServerRouteHost;
    const repo = createExpenseRepository(db);
    const settings = createSettingsRepository(db);
    const vehicles = createVehicleRepository(db);
    const shifts = createShiftRepository(db);
    const today = (userId: number) => localDate(now(), settings.get(userId)?.timezone ?? 'UTC');

    const doubleCounts = (userId: number, e: ExpenseRow) => doubleCountsOf(db, userId, e);
    const view = (userId: number, e: ExpenseRow) => ({
      id: e.id,
      spent_on: e.spentOn,
      category: e.category,
      amount_cents: e.amountCents,
      merchant: e.merchant,
      deductible: e.deductible === 1,
      business_pct: e.businessPct,
      tax_credit_cents: e.taxCreditCents,
      vehicle_id: e.vehicleId,
      shift_id: e.shiftId,
      notes: e.notes,
      recurrence: e.recurrence,
      next_due: e.nextDue,
      snoozed_until: e.snoozedUntil,
      template_id: e.templateId,
      deductible_cents: deductibleCents(e),
      double_counts: doubleCounts(userId, e),
      has_receipt: repo.hasReceipt(e.id),
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    });

    /** Checks the references and ranges that the JSON schema cannot (and fills the category defaults). */
    const check = (
      userId: number,
      b: Partial<Record<string, unknown>>,
      full: ExpenseRow | undefined,
    ) => {
      const errors: { path: string; message: string }[] = [];
      if (b.category !== undefined && !expenseCategory(String(b.category))) {
        errors.push({ path: '/category', message: 'is not an expense category' });
      }
      if (b.spent_on !== undefined && !calendar(String(b.spent_on)))
        errors.push({ path: '/spent_on', message: 'is not a calendar date' });
      if (b.next_due != null && !calendar(String(b.next_due)))
        errors.push({ path: '/next_due', message: 'is not a calendar date' });
      if (b.vehicle_id != null && !vehicles.find(userId, Number(b.vehicle_id)))
        errors.push({ path: '/vehicle_id', message: 'is not one of your vehicles' });
      if (b.shift_id != null && !shifts.byRef(userId, String(b.shift_id)))
        errors.push({ path: '/shift_id', message: 'is not one of your shifts' });
      const amount = Number(b.amount_cents ?? full?.amountCents ?? 1);
      if (Number(b.tax_credit_cents ?? full?.taxCreditCents ?? 0) > amount)
        errors.push({ path: '/tax_credit_cents', message: 'must not exceed the amount' });
      const rec = b.recurrence === undefined ? full?.recurrence : b.recurrence;
      const due = b.next_due === undefined ? full?.nextDue : b.next_due;
      if ((rec == null) !== (due == null))
        errors.push({ path: '/next_due', message: 'is needed with recurrence, and only then' });
      if (errors.length)
        throw new ProblemError('validation_failed', 'The expense is not valid.', errors);
    };
    const toRow = (userId: number, b: Record<string, unknown>): NewExpense => {
      const cat = expenseCategory(String(b.category))!;
      return {
        userId,
        spentOn: String(b.spent_on),
        category: cat.slug,
        amountCents: Number(b.amount_cents),
        merchant: String(b.merchant ?? '').trim(),
        deductible: (b.deductible ?? cat.default_deductible) ? 1 : 0,
        businessPct: Number(b.business_pct ?? cat.default_business_pct),
        taxCreditCents: Number(b.tax_credit_cents ?? 0),
        vehicleId: b.vehicle_id == null ? null : Number(b.vehicle_id),
        shiftId: b.shift_id == null ? null : Number(b.shift_id),
        notes: (b.notes as string | null | undefined) ?? null,
        recurrence: (b.recurrence as NewExpense['recurrence']) ?? null,
        nextDue: (b.next_due as string | null | undefined) ?? null,
        snoozedUntil: null,
        templateId: null,
      };
    };
    const mine = (userId: number, id: number) => {
      const e = repo.find(userId, id);
      if (!e) throw new ProblemError('not_found', 'No such expense.');
      return e;
    };

    app.get('/expenses/categories', async (req) => {
      authn.authenticate(req, 'S');
      return EXPENSE_CATEGORIES;
    });

    app.get(
      '/expenses/merchants',
      { schema: { querystring: strictObject({ q: str(0, 60) }, []) } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        return repo.merchants(userId, (req.query as { q?: string }).q ?? '');
      },
    );

    app.get('/expenses/due', async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      return repo.due(userId, today(userId)).map((e) => view(userId, e));
    });

    app.get(
      '/expenses/totals',
      {
        schema: {
          querystring: strictObject(
            { year: { type: 'integer', minimum: 2000, maximum: 2100 } },
            [],
          ),
        },
      },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const year = (req.query as { year?: number }).year ?? Number(today(userId).slice(0, 4));
        const rows = repo.between(userId, `${year}-01-01`, `${year}-12-31`);
        const by = new Map<string, { total: number; ded: number; dbl: number; n: number }>();
        for (const e of rows) {
          const t = by.get(e.category) ?? { total: 0, ded: 0, dbl: 0, n: 0 };
          const dbl = doubleCounts(userId, e);
          t.total += e.amountCents;
          t.ded += dbl ? 0 : deductibleCents(e);
          t.dbl += dbl ? deductibleCents(e) : 0;
          t.n += 1;
          by.set(e.category, t);
        }
        const cats = [...by.entries()].map(([category, t]) => ({
          category,
          count: t.n,
          total_cents: t.total,
          deductible_cents: t.ded,
          double_counts_cents: t.dbl,
        }));
        const sum = (f: (c: (typeof cats)[number]) => number) => cats.reduce((a, c) => a + f(c), 0);
        return {
          year,
          total_cents: sum((c) => c.total_cents),
          deductible_cents: sum((c) => c.deductible_cents),
          double_counts_cents: sum((c) => c.double_counts_cents),
          by_category: cats.sort((a, b) => b.total_cents - a.total_cents),
        };
      },
    );

    app.get('/expenses', { schema: { querystring: listQuery } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const q = req.query as {
        from?: string;
        to?: string;
        category?: string;
        deductible?: boolean;
        vehicle_id?: number;
        templates?: boolean;
        limit?: number;
        cursor?: string;
      };
      let after: { spentOn: string; id: number } | undefined;
      if (q.cursor) {
        try {
          const [spentOn, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [
            string,
            number,
          ];
          if (typeof spentOn !== 'string' || !Number.isInteger(id)) throw new Error('shape');
          after = { spentOn, id };
        } catch {
          throw invalid('/cursor', 'is not a cursor from this server');
        }
      }
      const limit = q.limit ?? 50;
      const rows = repo.list(userId, {
        from: q.from,
        to: q.to,
        category: q.category,
        deductible: q.deductible,
        vehicleId: q.vehicle_id,
        templates: q.templates,
        after,
        limit,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((e) => view(userId, e)),
        next_cursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify([last.spentOn, last.id])).toString('base64url')
            : null,
      };
    });

    app.post('/expenses', { schema: { body: createBody } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as Record<string, unknown>;
      check(userId, b, undefined);
      const row = repo.create(toRow(userId, b), now());
      bus.emit('expense.changed', { expenseId: String(row.id) });
      return reply.status(201).send(view(userId, row));
    });

    app.get('/expenses/:id', { schema: { params: idParams } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      return view(userId, mine(userId, (req.params as { id: number }).id));
    });

    app.patch('/expenses/:id', { schema: { params: idParams, body: patchBody } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      const current = mine(userId, id);
      const b = req.body as Record<string, unknown>;
      check(userId, b, current);
      const merged = toRow(userId, {
        spent_on: current.spentOn,
        category: current.category,
        amount_cents: current.amountCents,
        merchant: current.merchant,
        deductible: current.deductible === 1,
        business_pct: current.businessPct,
        tax_credit_cents: current.taxCreditCents,
        vehicle_id: current.vehicleId,
        shift_id: current.shiftId,
        notes: current.notes,
        recurrence: current.recurrence,
        next_due: current.nextDue,
        ...b,
      });
      const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const patch = Object.fromEntries(
        Object.keys(b).map((k) => [camel(k), merged[camel(k) as keyof NewExpense]]),
      );
      const saved = repo.update(userId, id, patch, now())!;
      bus.emit('expense.changed', { expenseId: String(id) });
      return view(userId, saved);
    });

    app.delete('/expenses/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const id = (req.params as { id: number }).id;
      mine(userId, id);
      const file = repo.receiptFile(id);
      repo.delete(userId, id);
      if (file) rmSync(join(receiptsDirOf(db), file), { force: true }); // evidence goes with its expense
      bus.emit('expense.changed', { expenseId: String(id) });
      return reply.status(204).send();
    });

    app.post(
      '/expenses/:id/occurrences',
      { schema: { params: idParams, body: occurrenceBody } },
      async (req, reply) => {
        const { userId } = authn.authenticate(req, 'S');
        const t = mine(userId, (req.params as { id: number }).id);
        if (!t.recurrence || !t.nextDue) throw invalid('/id', 'is not a recurring expense');
        const b = req.body as { spent_on: string; amount_cents?: number };
        if (!calendar(b.spent_on)) throw invalid('/spent_on', 'is not a calendar date');
        const amount = b.amount_cents ?? t.amountCents;
        const row = db.transaction(() => {
          const occurrence = repo.create(
            {
              ...t,
              spentOn: b.spent_on,
              amountCents: amount,
              taxCreditCents: Math.min(t.taxCreditCents, amount),
              recurrence: null,
              nextDue: null,
              snoozedUntil: null,
              templateId: t.id,
            },
            now(),
          );
          repo.update(
            userId,
            t.id,
            { nextDue: addInterval(t.nextDue!, t.recurrence!), snoozedUntil: null },
            now(),
          );
          return occurrence;
        })();
        bus.emit('expense.changed', { expenseId: String(row.id) });
        return reply.status(201).send(view(userId, row));
      },
    );

    app.put(
      '/expenses/:id/snooze',
      { schema: { params: idParams, body: snoozeBody } },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const id = (req.params as { id: number }).id;
        const t = mine(userId, id);
        const until = (req.body as { until: string }).until;
        if (!t.recurrence) throw invalid('/id', 'is not a recurring expense');
        if (!calendar(until)) throw invalid('/until', 'is not a calendar date');
        return view(userId, repo.update(userId, id, { snoozedUntil: until }, now())!);
      },
    );
  };
}
