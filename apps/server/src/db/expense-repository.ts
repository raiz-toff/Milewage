import type { Db } from './open';

export interface ExpenseRow {
  id: number;
  userId: number;
  spentOn: string;
  category: string;
  amountCents: number;
  merchant: string;
  deductible: number;
  businessPct: number;
  taxCreditCents: number;
  vehicleId: number | null;
  shiftId: number | null;
  notes: string | null;
  recurrence: 'weekly' | 'monthly' | 'yearly' | null;
  nextDue: string | null;
  snoozedUntil: string | null;
  templateId: number | null;
  createdAt: number;
  updatedAt: number;
}
export type NewExpense = Omit<ExpenseRow, 'id' | 'createdAt' | 'updatedAt'>;

const COLUMNS = `id, user_id AS userId, spent_on AS spentOn, category, amount_cents AS amountCents, merchant,
  deductible, business_pct AS businessPct, tax_credit_cents AS taxCreditCents, vehicle_id AS vehicleId,
  shift_id AS shiftId, notes, recurrence, next_due AS nextDue, snoozed_until AS snoozedUntil,
  template_id AS templateId, created_at AS createdAt, updated_at AS updatedAt`;

export interface ExpenseFilter {
  from?: string;
  to?: string;
  category?: string;
  deductible?: boolean;
  vehicleId?: number;
  /** Recurring templates instead of ordinary expenses. */
  templates?: boolean;
  after?: { spentOn: string; id: number };
  limit?: number;
}

/** Expenses and their recurring templates (module `expenses`). */
export function createExpenseRepository(db: Db) {
  const where = (userId: number, f: ExpenseFilter) => {
    const sql = [
      `user_id = @userId`,
      f.templates ? 'recurrence IS NOT NULL' : 'recurrence IS NULL',
    ];
    const args: Record<string, unknown> = { userId };
    const add = (clause: string, key: string, v: unknown) => {
      if (v === undefined) return;
      sql.push(clause);
      args[key] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    };
    add('spent_on >= @from', 'from', f.from);
    add('spent_on <= @to', 'to', f.to);
    add('category = @category', 'category', f.category);
    add('deductible = @deductible', 'deductible', f.deductible);
    add('vehicle_id = @vehicleId', 'vehicleId', f.vehicleId);
    if (f.after) {
      sql.push('(spent_on < @aDate OR (spent_on = @aDate AND id < @aId))');
      args.aDate = f.after.spentOn;
      args.aId = f.after.id;
    }
    return { clause: sql.join(' AND '), args };
  };
  const find = (userId: number, id: number) =>
    db.prepare(`SELECT ${COLUMNS} FROM expenses WHERE user_id = ? AND id = ?`).get(userId, id) as
      ExpenseRow | undefined;
  return {
    find,
    /** Newest first by (spent_on, id); `limit + 1` rows so the caller can tell if more exist. */
    list(userId: number, f: ExpenseFilter): ExpenseRow[] {
      const w = where(userId, f);
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM expenses WHERE ${w.clause} ORDER BY spent_on DESC, id DESC LIMIT ${(f.limit ?? 50) + 1}`,
        )
        .all(w.args) as ExpenseRow[];
    },
    /** Every ordinary expense of a date range (totals, tax, exports). */
    between: (userId: number, from: string, to: string): ExpenseRow[] =>
      db
        .prepare(
          `SELECT ${COLUMNS} FROM expenses WHERE user_id = ? AND recurrence IS NULL AND spent_on BETWEEN ? AND ? ORDER BY spent_on, id`,
        )
        .all(userId, from, to) as ExpenseRow[],
    create(r: NewExpense, now: number): ExpenseRow {
      const info = db
        .prepare(
          `INSERT INTO expenses (user_id, spent_on, category, amount_cents, merchant, deductible, business_pct,
             tax_credit_cents, vehicle_id, shift_id, notes, recurrence, next_due, snoozed_until, template_id, created_at, updated_at)
           VALUES (@userId, @spentOn, @category, @amountCents, @merchant, @deductible, @businessPct,
             @taxCreditCents, @vehicleId, @shiftId, @notes, @recurrence, @nextDue, @snoozedUntil, @templateId, @now, @now)`,
        )
        .run({ ...r, now });
      return find(r.userId, Number(info.lastInsertRowid))!;
    },
    update(
      userId: number,
      id: number,
      r: Partial<NewExpense>,
      now: number,
    ): ExpenseRow | undefined {
      const cols: Record<keyof NewExpense, string> = {
        userId: 'user_id',
        spentOn: 'spent_on',
        category: 'category',
        amountCents: 'amount_cents',
        merchant: 'merchant',
        deductible: 'deductible',
        businessPct: 'business_pct',
        taxCreditCents: 'tax_credit_cents',
        vehicleId: 'vehicle_id',
        shiftId: 'shift_id',
        notes: 'notes',
        recurrence: 'recurrence',
        nextDue: 'next_due',
        snoozedUntil: 'snoozed_until',
        templateId: 'template_id',
      };
      const keys = Object.keys(r).filter((k) => k in cols) as (keyof NewExpense)[];
      const set = keys
        .map((k) => `${cols[k]} = @${k}`)
        .concat('updated_at = @now')
        .join(', ');
      db.prepare(`UPDATE expenses SET ${set} WHERE user_id = @userId AND id = @id`).run({
        ...Object.fromEntries(keys.map((k) => [k, r[k]])),
        userId,
        id,
        now,
      });
      return find(userId, id);
    },
    /** Deleting a template keeps its occurrences (their `template_id` becomes null). */
    delete(userId: number, id: number): boolean {
      return db.transaction(() => {
        db.prepare('UPDATE expenses SET template_id = NULL WHERE template_id = ?').run(id);
        return (
          db.prepare('DELETE FROM expenses WHERE user_id = ? AND id = ?').run(userId, id).changes >
          0
        );
      })();
    },
    merchants: (userId: number, q: string): string[] =>
      db
        .prepare(
          `SELECT merchant FROM expenses WHERE user_id = ? AND merchant <> '' AND merchant LIKE ? ESCAPE '\\'
           GROUP BY merchant ORDER BY max(spent_on) DESC LIMIT 10`,
        )
        .pluck()
        .all(userId, `${q.replace(/[\\%_]/g, '\\$&')}%`) as string[],
    /** Templates due on `today` and not snoozed past it. */
    due: (userId: number, today: string): ExpenseRow[] =>
      db
        .prepare(
          `SELECT ${COLUMNS} FROM expenses WHERE user_id = ? AND recurrence IS NOT NULL AND next_due <= ?
             AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY next_due, id`,
        )
        .all(userId, today, today) as ExpenseRow[],
    /** The year's ordinary spending per category. */
    hasReceipt: (expenseId: number): boolean => {
      try {
        return (
          db.prepare('SELECT 1 FROM expense_receipts WHERE expense_id = ?').get(expenseId) !==
          undefined
        );
      } catch {
        return false; // the receipts table arrives with its own migration
      }
    },
  };
}
export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
