import { randomUUID } from 'node:crypto';
import { expenseCategory, EXPENSE_CATEGORIES } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createEarningsRepository,
  createExpenseRepository,
  createSettingsRepository,
  createVehicleRepository,
  type Db,
  type NewExpense,
} from '../db';
import { ProblemError } from '../errors';
import {
  FIELDS,
  guessMapping,
  parseCsv,
  toBool,
  toCents,
  toDate,
  toMinutes,
  zonedInstant,
  type ImportKind,
} from '../imports/csv';
import { localDate } from '../time';
import { platformKnown } from './platforms';
import { strictObject } from './util';

const MAX_BYTES = 5 * 1024 * 1024;
/**
 * The most problem rows a preview lists. A 5 MB file can hold about 100 000 rows; when every one
 * has a problem the mapping is wrong, and a list that long helps no one. 1000 rows is about 60 KB.
 */
const MAX_PROBLEMS = 1000;
const params = strictObject({ kind: { enum: ['expenses', 'shifts'] } }, ['kind']);
const query = strictObject({ mapping: { type: 'string', maxLength: 4000 } }, []);

type Status = 'ok' | 'duplicate' | 'error';
interface Planned<T> {
  row: number;
  status: Status;
  message?: string;
  value?: T;
}
interface ShiftPlan {
  vehicleId: number;
  startedAt: number;
  endedAt: number;
  localDate: string;
  totalM: number;
  notes: string | null;
  platform: string;
  gross: number;
  tips: number;
  bonus: number;
}

/**
 * Module `import` (18 section 12): a generic CSV import of the driver's own records, in two steps so
 * nothing is written by surprise. No vendor format is known; the driver confirms the column mapping.
 */
export function importsRoutes({
  db,
  now,
  authn,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
}) {
  return ({ app, registry, bus }: ServerRouteHost) => {
    const settings = createSettingsRepository(db);
    const vehicles = createVehicleRepository(db);
    const expenses = createExpenseRepository(db);
    const earnings = createEarningsRepository(db);
    // The CSV arrives as text; the body limit of this module's routes is its own.
    app.addContentTypeParser(
      'text/csv',
      { parseAs: 'string', bodyLimit: MAX_BYTES },
      (_r, body, done) => done(null, body),
    );

    const bad = (path: string, message: string) =>
      new ProblemError('validation_failed', 'The import is not valid.', [{ path, message }]);

    /** The table, the mapping (confirmed or guessed) and a getter for a row's mapped field. */
    function read(kind: ImportKind, body: unknown, rawMapping: string | undefined) {
      if (typeof body !== 'string' || body.trim() === '')
        throw bad('/', 'send the CSV file as text/csv');
      const table = parseCsv(body);
      if (table.length < 2) throw bad('/', 'the file needs a header row and at least one row');
      const header = table[0]!.map((h) => h.trim());
      let mapping = guessMapping(kind, header);
      if (rawMapping !== undefined) {
        let given: Record<string, string | null>;
        try {
          given = JSON.parse(rawMapping) as Record<string, string | null>;
        } catch {
          throw bad('/mapping', 'is not JSON');
        }
        for (const [field, col] of Object.entries(given)) {
          if (!(field in FIELDS[kind])) throw bad('/mapping', `${field} is not a field of ${kind}`);
          if (col !== null && !header.includes(col))
            throw bad('/mapping', `${col} is not a column of the file`);
        }
        mapping = {
          ...Object.fromEntries(Object.keys(FIELDS[kind]).map((f) => [f, null])),
          ...given,
        };
      }
      const idx = (field: string) => (mapping[field] ? header.indexOf(mapping[field]!) : -1);
      return {
        header,
        mapping,
        rows: table.slice(1),
        cell: (r: string[], field: string) => (idx(field) < 0 ? '' : (r[idx(field)] ?? '').trim()),
      };
    }

    function planExpenses(userId: number, t: ReturnType<typeof read>): Planned<NewExpense>[] {
      const seen = new Set(
        db
          .prepare(
            "SELECT spent_on || '|' || amount_cents || '|' || merchant FROM expenses WHERE user_id = ? AND recurrence IS NULL",
          )
          .pluck()
          .all(userId) as string[],
      );
      return t.rows.map((r, i) => {
        const row = i + 1;
        const c = (f: string) => t.cell(r, f);
        const spentOn = toDate(c('spent_on'));
        const amount = toCents(c('amount'));
        if (!spentOn) return { row, status: 'error', message: 'date is not YYYY-MM-DD' };
        if (!Number.isFinite(amount) || amount <= 0)
          return { row, status: 'error', message: 'amount is not a positive amount' };
        const cat =
          expenseCategory(c('category').toLowerCase()) ??
          EXPENSE_CATEGORIES.find((x) => x.label.toLowerCase() === c('category').toLowerCase()) ??
          expenseCategory('other')!;
        const pct =
          c('business_pct') === ''
            ? cat.default_business_pct
            : Number(c('business_pct').replace('%', ''));
        if (!Number.isInteger(pct) || pct < 0 || pct > 100)
          return { row, status: 'error', message: 'business use must be 0 to 100' };
        const merchant = c('merchant');
        const key = `${spentOn}|${amount}|${merchant}`;
        if (seen.has(key)) return { row, status: 'duplicate' };
        seen.add(key);
        return {
          row,
          status: 'ok',
          value: {
            userId,
            spentOn,
            category: cat.slug,
            amountCents: amount,
            merchant,
            deductible: (toBool(c('deductible')) ?? cat.default_deductible) ? 1 : 0,
            businessPct: pct,
            taxCreditCents: 0,
            vehicleId: null,
            shiftId: null,
            notes: c('notes') || null,
            recurrence: null,
            nextDue: null,
            snoozedUntil: null,
            templateId: null,
          },
        };
      });
    }

    function planShifts(userId: number, t: ReturnType<typeof read>): Planned<ShiftPlan>[] {
      const prefs = settings.get(userId)!;
      const all = vehicles.list(userId, false);
      const fallback =
        all.find((v) => v.id === prefs.defaultVehicleId) ?? (all.length === 1 ? all[0] : undefined);
      const unitM = prefs.distanceUnit === 'km' ? 1000 : 1609.344;
      const seen = new Set(
        db
          .prepare(
            "SELECT vehicle_id || '|' || started_at || '|' || coalesce(total_m, 0) FROM shifts WHERE user_id = ?",
          )
          .pluck()
          .all(userId) as string[],
      );
      return t.rows.map((r, i) => {
        const row = i + 1;
        const c = (f: string) => t.cell(r, f);
        const date = toDate(c('date'));
        const start = toMinutes(c('start_time'));
        if (!date) return { row, status: 'error', message: 'date is not YYYY-MM-DD' };
        if (start === undefined)
          return { row, status: 'error', message: 'start time is not HH:MM' };
        let minutes: number | undefined;
        if (c('end_time') !== '') {
          const end = toMinutes(c('end_time'));
          if (end !== undefined) minutes = (end - start + 1440) % 1440;
        } else if (c('duration_min') !== '') {
          const d = Number(c('duration_min'));
          if (Number.isInteger(d) && d > 0 && d <= 1440) minutes = d;
        }
        if (!minutes)
          return { row, status: 'error', message: 'needs an end time or a duration in minutes' };
        const distance = Number(c('distance').replace(',', '.'));
        if (c('distance') === '' || !Number.isFinite(distance) || distance < 0) {
          return { row, status: 'error', message: 'distance is not a number' };
        }
        const vehicle =
          c('vehicle') === ''
            ? fallback
            : all.find((v) => v.name.toLowerCase() === c('vehicle').toLowerCase());
        if (!vehicle)
          return {
            row,
            status: 'error',
            message: 'no vehicle: name one of yours or set a default vehicle',
          };
        const money = [c('gross'), c('tips'), c('bonus')].map((x) => (x === '' ? 0 : toCents(x)));
        if (money.some((m) => !Number.isFinite(m) || m < 0))
          return { row, status: 'error', message: 'earnings must be amounts of zero or more' };
        const platform = (c('platform') || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (money.some((m) => m > 0)) {
          if (!registry.isEnabled('earnings'))
            return { row, status: 'error', message: 'the earnings module is off' };
          if (registry.isEnabled('platforms') && !platformKnown(db, userId, platform)) {
            return { row, status: 'error', message: `${platform} is not one of your platforms` };
          }
        }
        const startedAt = zonedInstant(date, start, prefs.timezone);
        const totalM = Math.round(distance * unitM);
        const key = `${vehicle.id}|${startedAt}|${totalM}`;
        if (seen.has(key)) return { row, status: 'duplicate' };
        seen.add(key);
        return {
          row,
          status: 'ok',
          value: {
            vehicleId: vehicle.id,
            startedAt,
            endedAt: startedAt + minutes * 60_000,
            localDate: localDate(startedAt, prefs.timezone),
            totalM,
            notes: c('notes') || null,
            platform,
            gross: money[0]!,
            tips: money[1]!,
            bonus: money[2]!,
          },
        };
      });
    }

    const summarize = (plan: Planned<unknown>[]) => ({
      ok: plan.filter((p) => p.status === 'ok').length,
      duplicate: plan.filter((p) => p.status === 'duplicate').length,
      error: plan.filter((p) => p.status === 'error').length,
    });

    function plan(kind: ImportKind, userId: number, body: unknown, mapping: string | undefined) {
      const t = read(kind, body, mapping);
      const planned = kind === 'expenses' ? planExpenses(userId, t) : planShifts(userId, t);
      return { t, planned };
    }
    const guardKind = (kind: ImportKind) => {
      if (kind === 'expenses' && !registry.isEnabled('expenses')) {
        throw new ProblemError('not_found', 'Expenses are turned off.');
      }
    };

    app.post(
      '/imports/:kind/preview',
      { schema: { params, querystring: query }, bodyLimit: MAX_BYTES },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const kind = (req.params as { kind: ImportKind }).kind;
        guardKind(kind);
        const { t, planned } = plan(
          kind,
          userId,
          req.body,
          (req.query as { mapping?: string }).mapping,
        );
        return {
          kind,
          columns: t.header,
          fields: Object.keys(FIELDS[kind]),
          mapping: t.mapping,
          row_count: planned.length,
          summary: summarize(planned),
          rows: planned
            .slice(0, 200)
            .map(({ row, status, message }) => ({ row, status, message: message ?? null })),
          problems: planned
            .filter((p) => p.status === 'error')
            .slice(0, MAX_PROBLEMS)
            .map(({ row, message }) => ({ row, message: message ?? null })),
        };
      },
    );

    app.post(
      '/imports/:kind',
      { schema: { params, querystring: query }, bodyLimit: MAX_BYTES },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const kind = (req.params as { kind: ImportKind }).kind;
        guardKind(kind);
        const { planned } = plan(
          kind,
          userId,
          req.body,
          (req.query as { mapping?: string }).mapping,
        );
        const ok = planned.filter((p) => p.status === 'ok');
        const created: number[] = [];
        db.transaction(() => {
          for (const p of ok) {
            if (kind === 'expenses') {
              created.push(expenses.create(p.value as NewExpense, now()).id);
              continue;
            }
            const s = p.value as ShiftPlan;
            const id = Number(
              db
                .prepare(
                  `INSERT INTO shifts (user_id, client_id, vehicle_id, status, started_at, ended_at, local_date, total_m, active_m,
                   deadhead_m, personal_m, segmenter, notes, updated_at)
                 VALUES (?, ?, ?, 'finalized', ?, ?, ?, ?, ?, 0, 0, 'whole_shift', ?, ?)`,
                )
                .run(
                  userId,
                  randomUUID(),
                  s.vehicleId,
                  s.startedAt,
                  s.endedAt,
                  s.localDate,
                  s.totalM,
                  s.totalM,
                  s.notes,
                  now(),
                ).lastInsertRowid,
            );
            db.prepare(
              `INSERT INTO trips (user_id, shift_id, trip_key, kind, original_kind, source, started_at, ended_at, distance_m, purpose, edited_at)
             VALUES (?, ?, ?, 'active', 'active', 'manual', ?, ?, ?, 'Imported', ?)`,
            ).run(userId, id, `import-${id}`, s.startedAt, s.endedAt, s.totalM, now());
            db.prepare(
              "INSERT INTO shift_flags (user_id, shift_id, code, severity, detail, created_at) VALUES (?, ?, 'imported', 'info', ?, ?)",
            ).run(
              userId,
              id,
              JSON.stringify({
                at: null,
                detail: 'imported from a CSV file; the distance was typed, not tracked',
              }),
              now(),
            );
            if (s.gross + s.tips + s.bonus > 0) {
              earnings.put({
                userId,
                shiftId: id,
                platform: s.platform,
                grossCents: s.gross,
                tipsCents: s.tips,
                bonusCents: s.bonus,
                orders: null,
                onlineMin: null,
                notes: null,
                source: 'import',
                editedAt: now(),
              });
            }
            created.push(id);
          }
        })();
        for (const id of created) {
          bus.emit(
            kind === 'expenses' ? 'expense.changed' : 'shift.updated',
            kind === 'expenses' ? { expenseId: String(id) } : { shiftId: String(id) },
          );
        }
        return {
          kind,
          imported: created.length,
          duplicates: planned.filter((p) => p.status === 'duplicate').length,
          errors: planned.filter((p) => p.status === 'error').length,
          error_rows: planned
            .filter((p) => p.status === 'error')
            .slice(0, 50)
            .map(({ row, message }) => ({ row, message: message ?? null })),
        };
      },
    );
  };
}
