import { expenseCategory, EXPENSE_CATEGORIES } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createEarningsRepository,
  createExpenseRepository,
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
  type ImportKind,
} from '../imports/csv';
import type { DriverContexts } from '../driver-context';
import {
  countryDayOrder,
  dayOf,
  MileIqError,
  readMileIq,
  unspecified,
  type DriveClass,
} from '../imports/mileiq';
import type { ImportedShift, ShiftBook } from '../processing/shift-book';
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
const mileIqQuery = strictObject(
  {
    unclassified: { enum: ['personal', 'skip'] },
    date_order: { enum: ['mdy', 'dmy'] },
  },
  [],
);
/** Drives the MileIQ preview shows in full; the counts cover them all. */
const MILEIQ_FIRST = 20;
/** The longest a drive may last: a longer one is a misread date, not a drive. */
const DAY_MS = 24 * 60 * 60 * 1000;
const M_PER = { mi: 1609.344, km: 1000 } as const;

interface DrivePlan extends ImportedShift {
  cls: DriveClass;
  parking: number;
  tolls: number;
}
interface MileIqRow {
  line: number;
  status: Status | 'skipped';
  message?: string;
  cls?: DriveClass;
  startedAt?: number;
  distanceM?: number;
  purpose?: string;
  value?: DrivePlan;
}

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
  drivers,
  book,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  drivers: DriverContexts;
  /** Imported shifts are recorded and announced like any other, so they reach the phone's pull. */
  book: ShiftBook;
}) {
  return ({ app, registry, bus }: ServerRouteHost) => {
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
      const driver = drivers.of(userId);
      const all = vehicles.list(userId, false);
      const fallback =
        all.find((v) => v.id === driver.settings.defaultVehicleId) ??
        (all.length === 1 ? all[0] : undefined);
      const unitM = driver.unit === 'km' ? 1000 : 1609.344;
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
        const startedAt = driver.instantOf(date, start);
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
            localDate: driver.dateOf(startedAt),
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

    /**
     * The MileIQ preset (ADR 0008's sibling decision in DECISIONS.md, 2026-11-10): one drive becomes
     * one imported shift with one manual trip. Business drives are business distance; personal,
     * commute, medical, charity and moving drives are personal trips (ADR 0005); unclassified drives
     * are personal or left out, as the driver chooses. Parking and tolls of a business drive become
     * expenses linked to its shift. MileIQ's value columns are not read. Places stay text in notes.
     */
    function planMileIq(
      userId: number,
      body: unknown,
      q: { unclassified?: 'personal' | 'skip'; date_order?: 'mdy' | 'dmy' },
    ) {
      if (typeof body !== 'string' || body.trim() === '')
        throw bad('/', 'send the CSV file as text/csv');
      let file;
      try {
        file = readMileIq(body, drivers.of(userId).currency);
      } catch (e) {
        if (e instanceof MileIqError) throw bad('/', e.message);
        throw e;
      }
      if (file.mixedOrder && !q.date_order) {
        throw bad(
          '/date_order',
          'the dates are written both day-first and month-first; choose the order of the file',
        );
      }
      const driver = drivers.of(userId);
      const order = q.date_order ?? file.dayOrder ?? countryDayOrder(driver.country);
      const orderSource = q.date_order ? 'chosen' : file.dayOrder ? 'file' : 'country';
      const unclassified = q.unclassified ?? 'personal';
      const all = vehicles.list(userId, false);
      const fallback =
        all.find((v) => v.id === driver.settings.defaultVehicleId) ??
        (all.length === 1 ? all[0] : undefined);
      const vehicleOf = (name: string) =>
        unspecified(name)
          ? fallback
          : (all.find((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase()) ??
            fallback);
      const seen = new Set(
        db
          .prepare(
            "SELECT vehicle_id || '|' || started_at || '|' || coalesce(total_m, 0) FROM shifts WHERE user_id = ?",
          )
          .pluck()
          .all(userId) as string[],
      );
      const expensesOn = registry.isEnabled('expenses');
      const vehicleCounts = new Map<
        string,
        { drives: number; id: number | null; matched: boolean }
      >();
      const rows: MileIqRow[] = file.rows.map((r): MileIqRow => {
        if ('error' in r) return { line: r.line, status: 'error', message: r.error };
        const d = r.drive;
        const vehicleName = unspecified(d.vehicle) ? '' : d.vehicle.trim();
        const vehicle = vehicleOf(d.vehicle);
        const seenName = vehicleCounts.get(vehicleName) ?? {
          drives: 0,
          id: vehicle?.id ?? null,
          matched:
            vehicleName !== '' &&
            all.some((v) => v.name.trim().toLowerCase() === vehicleName.toLowerCase()),
        };
        seenName.drives++;
        vehicleCounts.set(vehicleName, seenName);
        const base = { line: d.line, cls: d.cls };
        const startDay = dayOf(d.start, order);
        const endDay = d.end ? dayOf(d.end, order) : undefined;
        if (!startDay || (d.end && !endDay)) {
          return {
            ...base,
            status: 'error',
            message: `the date is not a day in ${order === 'mdy' ? 'month/day/year' : 'day/month/year'} order`,
          };
        }
        if (!d.end)
          return { ...base, status: 'error', message: 'the end date and time are missing' };
        const startedAt = driver.instantOf(startDay, d.start.minutes);
        const endedAt = driver.instantOf(endDay!, d.end.minutes);
        if (endedAt < startedAt)
          return { ...base, status: 'error', message: 'the drive ends before it starts' };
        if (endedAt - startedAt > DAY_MS)
          return { ...base, status: 'error', message: 'the drive lasts more than a day' };
        const totalM = Math.round(d.distance * M_PER[file.unit]);
        if (totalM <= 0) return { ...base, status: 'error', message: 'the distance is zero' };
        const purpose = (d.purpose || d.category || 'Unclassified').slice(0, 200);
        const shown = { ...base, startedAt, distanceM: totalM, purpose };
        if (d.cls === 'unclassified' && unclassified === 'skip')
          return { ...shown, status: 'skipped', message: 'unclassified, left out' };
        if (!vehicle) {
          return {
            ...shown,
            status: 'error',
            message: vehicleName
              ? `no vehicle named ${vehicleName}: add it in Vehicles or set a default vehicle`
              : 'no vehicle: set a default vehicle in Settings',
          };
        }
        const key = `${vehicle.id}|${startedAt}|${totalM}`;
        if (seen.has(key)) return { ...shown, status: 'duplicate' };
        seen.add(key);
        const business = d.cls === 'business';
        const notes = [
          'Imported from MileIQ.',
          d.from ? `From: ${d.from}.` : '',
          d.to ? `To: ${d.to}.` : '',
          d.cls === 'other' ? `MileIQ category: ${d.category}.` : '',
          d.cls === 'unclassified' ? 'Unclassified in MileIQ, imported as personal.' : '',
          d.notes ? `Notes: ${d.notes}` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 2000);
        return {
          ...shown,
          status: 'ok',
          value: {
            vehicleId: vehicle.id,
            startedAt,
            endedAt,
            localDate: driver.dateOf(startedAt),
            totalM,
            notes,
            kind: business ? 'active' : 'personal',
            purpose,
            from: 'a MileIQ report',
            cls: d.cls,
            // Costs of a business drive only, and only while the expenses module is on.
            parking: business && expensesOn ? d.parking : 0,
            tolls: business && expensesOn ? d.tolls : 0,
          },
        };
      });
      const ok = rows.filter((r) => r.status === 'ok');
      const read = rows.filter((r) => r.cls !== undefined);
      const costsLeftOut = file.rows.filter(
        (r) =>
          'drive' in r &&
          (r.drive.parking > 0 || r.drive.tolls > 0) &&
          (r.drive.cls !== 'business' || !expensesOn),
      ).length;
      return {
        rows,
        ok,
        preview: {
          drive_count: rows.length,
          summary: {
            ok: ok.length,
            duplicate: rows.filter((r) => r.status === 'duplicate').length,
            error: rows.filter((r) => r.status === 'error').length,
            skipped: rows.filter((r) => r.status === 'skipped').length,
          },
          classes: {
            business: read.filter((r) => r.cls === 'business').length,
            personal: read.filter((r) => r.cls === 'personal').length,
            other: read.filter((r) => r.cls === 'other').length,
            unclassified: read.filter((r) => r.cls === 'unclassified').length,
          },
          distance_m: {
            business: ok.reduce(
              (a, r) => a + (r.value!.kind === 'active' ? r.value!.totalM : 0),
              0,
            ),
            personal: ok.reduce(
              (a, r) => a + (r.value!.kind === 'personal' ? r.value!.totalM : 0),
              0,
            ),
          },
          unit: file.unit,
          date_order: order,
          date_order_source: orderSource,
          unclassified,
          value_ignored: file.hasValue,
          vehicles: [...vehicleCounts].map(([name, v]) => ({
            name: name === '' ? null : name,
            drives: v.drives,
            vehicle_id: v.id,
            matched: v.matched,
          })),
          costs: {
            parking_cents: ok.reduce((a, r) => a + r.value!.parking, 0),
            tolls_cents: ok.reduce((a, r) => a + r.value!.tolls, 0),
            expenses: ok.reduce(
              (a, r) => a + (r.value!.parking > 0 ? 1 : 0) + (r.value!.tolls > 0 ? 1 : 0),
              0,
            ),
            left_out: costsLeftOut,
          },
          rows: rows.slice(0, MILEIQ_FIRST).map((r) => ({
            line: r.line,
            status: r.status,
            message: r.message ?? null,
            class: r.cls ?? null,
            started_at: r.startedAt ?? null,
            distance_m: r.distanceM ?? null,
            purpose: r.purpose ?? null,
          })),
          problems: rows
            .filter((r) => r.status === 'error')
            .slice(0, MAX_PROBLEMS)
            .map((r) => ({ line: r.line, message: r.message ?? '' })),
        },
      };
    }

    app.post(
      '/imports/mileiq/preview',
      { schema: { querystring: mileIqQuery }, bodyLimit: MAX_BYTES },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        return planMileIq(userId, req.body, req.query as never).preview;
      },
    );

    app.post(
      '/imports/mileiq',
      { schema: { querystring: mileIqQuery }, bodyLimit: MAX_BYTES },
      async (req) => {
        const { userId } = authn.authenticate(req, 'S');
        const { rows, ok } = planMileIq(userId, req.body, req.query as never);
        const plans = ok.map((r) => r.value!);
        const t = now();
        const made: number[] = [];
        const cost = (
          category: 'parking' | 'tolls',
          amount: number,
          shiftId: number,
          p: DrivePlan,
        ) => {
          const cat = expenseCategory(category)!;
          made.push(
            expenses.create(
              {
                userId,
                spentOn: p.localDate,
                category,
                amountCents: amount,
                merchant: '',
                deductible: cat.default_deductible ? 1 : 0,
                businessPct: cat.default_business_pct,
                taxCreditCents: 0,
                vehicleId: p.vehicleId,
                shiftId,
                notes: 'Imported from MileIQ',
                recurrence: null,
                nextDue: null,
                snoozedUntil: null,
                templateId: null,
              },
              t,
            ).id,
          );
        };
        // One transaction: every shift with its trip and flag, and its parking and tolls.
        const created = book.importShifts(userId, plans, (shift, i) => {
          const p = plans[i]!;
          if (p.parking > 0) cost('parking', p.parking, shift.id, p);
          if (p.tolls > 0) cost('tolls', p.tolls, shift.id, p);
        });
        for (const id of made) bus.emit('expense.changed', { expenseId: String(id) });
        return {
          imported: created.length,
          duplicates: rows.filter((r) => r.status === 'duplicate').length,
          errors: rows.filter((r) => r.status === 'error').length,
          skipped: rows.filter((r) => r.status === 'skipped').length,
          expenses: made.length,
        };
      },
    );

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
        let created: number[];
        if (kind === 'expenses') {
          created = db.transaction(() =>
            ok.map((p) => expenses.create(p.value as NewExpense, now()).id),
          )();
          for (const id of created) bus.emit('expense.changed', { expenseId: String(id) });
        } else {
          const plans = ok.map((p) => p.value as ShiftPlan);
          // One transaction: every shift with its trip and flag, and its earnings row.
          const rows = book.importShifts(userId, plans, (shift, i) => {
            const s = plans[i]!;
            if (s.gross + s.tips + s.bonus === 0) return;
            earnings.put({
              userId,
              shiftId: shift.id,
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
          });
          created = rows.map((r) => r.id);
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
