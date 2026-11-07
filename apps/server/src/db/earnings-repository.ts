import type { Db } from './open';

/** The closed list of entry types (22 section 3.2). */
// prettier-ignore
export const ENTRY_TYPES = ['fare', 'tip', 'bonus', 'cash_collected', 'commission', 'platform_fee',
  'tax_withheld', 'top_up', 'payout', 'adjustment'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export interface EarningEntry {
  id: number;
  type: EntryType;
  amountCents: number;
  note: string | null;
  createdAt: number;
}

/** Sums of a row's entries, each with its sign (22 section 3.3). */
export interface EntrySums {
  grossCents: number;
  tipsCents: number;
  bonusCents: number;
  /** Commission and platform fees; zero or below. */
  feesCents: number;
  adjustmentsCents: number;
  /** Zero or below. */
  taxWithheldCents: number;
  /** Zero or below. */
  cashCollectedCents: number;
  /** All entries: how the row changed what the platform owes the driver. */
  balanceCents: number;
}

export interface EarningsRow extends EntrySums {
  id: number;
  userId: number;
  shiftId: number;
  platform: string;
  orders: number | null;
  onlineMin: number | null;
  notes: string | null;
  source: 'manual' | 'import';
  editedAt: number;
}

const sumOf = (types: string, as: string) =>
  `coalesce(sum(CASE WHEN x.type IN (${types}) THEN x.amount_cents END), 0) AS ${as}`;
/** SQL for the sums over entries `x` grouped by their row. */
const SUMS = [
  sumOf("'fare'", 'grossCents'),
  sumOf("'tip'", 'tipsCents'),
  sumOf("'bonus'", 'bonusCents'),
  sumOf("'commission','platform_fee'", 'feesCents'),
  sumOf("'adjustment'", 'adjustmentsCents'),
  sumOf("'tax_withheld'", 'taxWithheldCents'),
  sumOf("'cash_collected'", 'cashCollectedCents'),
  'coalesce(sum(x.amount_cents), 0) AS balanceCents',
].join(', ');

const ROWS = `SELECT e.id, e.user_id AS userId, e.shift_id AS shiftId, e.platform, e.orders,
    e.online_min AS onlineMin, e.notes, e.source, e.edited_at AS editedAt, ${SUMS}
  FROM shift_earnings e LEFT JOIN earning_entries x ON x.earnings_id = e.id`;

/** A figure per shift and platform after the override rule (18 section 4.3). */
export interface EffectiveRow {
  shiftId: number;
  localDate: string;
  platform: string;
  grossCents: number;
  tipsCents: number;
  bonusCents: number;
  feesCents: number;
  adjustmentsCents: number;
  taxWithheldCents: number;
  orders: number | null;
  onlineMin: number | null;
  /** Where the figure comes from; `mixed` only under the `sum` rule. */
  source: 'labels' | 'entered' | 'mixed';
}

/** Earnings: after the platform's commission and fees, before tax withheld (22 section 3.3). */
export const totalOf = (r: EffectiveRow) =>
  r.grossCents + r.tipsCents + r.bonusCents + r.feesCents + r.adjustmentsCents;

export interface EffectiveOptions {
  /** Count the driver's stop labels (module `stops` on and the setting on). */
  labels: boolean;
  /** Count the typed entries (module `earnings` on). */
  entries: boolean;
  override: 'replace' | 'sum';
  platform?: string;
}

/** What the `PUT` of today's API sets: three amounts and the row's own fields. */
export type EarningsPut = Omit<
  EarningsRow,
  'id' | Exclude<keyof EntrySums, 'grossCents' | 'tipsCents' | 'bonusCents'>
>;

/** The driver-entered earnings (module `earnings`). */
export function createEarningsRepository(db: Db) {
  const upsertRow = db.prepare(
    `INSERT INTO shift_earnings (user_id, shift_id, platform, orders, online_min, notes, source, edited_at)
     VALUES (@userId, @shiftId, @platform, @orders, @onlineMin, @notes, @source, @editedAt)
     ON CONFLICT (shift_id, platform) DO UPDATE SET orders = @orders, online_min = @onlineMin,
       notes = @notes, source = @source, edited_at = @editedAt
     RETURNING id`,
  );
  const insertEntry = db.prepare(
    'INSERT INTO earning_entries (earnings_id, type, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  return {
    ofShift: (shiftId: number): EarningsRow[] =>
      db
        .prepare(`${ROWS} WHERE e.shift_id = ? GROUP BY e.id ORDER BY e.platform`)
        .all(shiftId) as EarningsRow[],
    find: (shiftId: number, platform: string): EarningsRow | undefined =>
      db
        .prepare(`${ROWS} WHERE e.shift_id = ? AND e.platform = ? GROUP BY e.id`)
        .get(shiftId, platform) as EarningsRow | undefined,
    /** Entries of one row, oldest first. */
    entriesOf: (earningsId: number): EarningEntry[] =>
      db
        .prepare(
          'SELECT id, type, amount_cents AS amountCents, note, created_at AS createdAt FROM earning_entries WHERE earnings_id = ? ORDER BY id',
        )
        .all(earningsId) as EarningEntry[],
    /**
     * Today's `PUT`: sets the row's fields, and for fare, tip and bonus replaces their entries by one
     * of the sent amount, unless they already add up to it. Entries of other types are kept.
     */
    put: db.transaction((r: EarningsPut) => {
      const { id } = upsertRow.get(r) as { id: number };
      const now = new Map(
        (
          db
            .prepare(
              'SELECT type, sum(amount_cents) AS total FROM earning_entries WHERE earnings_id = ? GROUP BY type',
            )
            .all(id) as { type: EntryType; total: number }[]
        ).map((x) => [x.type, x.total]),
      );
      const sent: [EntryType, number][] = [
        ['fare', r.grossCents],
        ['tip', r.tipsCents],
        ['bonus', r.bonusCents],
      ];
      for (const [type, amount] of sent) {
        if ((now.get(type) ?? 0) === amount) continue;
        db.prepare('DELETE FROM earning_entries WHERE earnings_id = ? AND type = ?').run(id, type);
        if (amount !== 0) insertEntry.run(id, type, amount, null, r.editedAt);
      }
      return id;
    }),
    /** One entry on the row of (shift, platform), creating the row if missing. Returns the entry id. */
    addEntry: db.transaction(
      (
        r: Pick<EarningsRow, 'userId' | 'shiftId' | 'platform' | 'editedAt'>,
        e: Omit<EarningEntry, 'id' | 'createdAt'>,
      ) => {
        const row = db
          .prepare(
            `INSERT INTO shift_earnings (user_id, shift_id, platform, source, edited_at) VALUES (?, ?, ?, 'manual', ?)
             ON CONFLICT (shift_id, platform) DO UPDATE SET source = 'manual', edited_at = excluded.edited_at
             RETURNING id`,
          )
          .get(r.userId, r.shiftId, r.platform, r.editedAt) as { id: number };
        return Number(
          insertEntry.run(row.id, e.type, e.amountCents, e.note, r.editedAt).lastInsertRowid,
        );
      },
    ),
    /** Removes one entry of the row; the row stays. True when something was removed. */
    deleteEntry: (earningsId: number, entryId: number): boolean =>
      db
        .prepare('DELETE FROM earning_entries WHERE id = ? AND earnings_id = ?')
        .run(entryId, earningsId).changes > 0,
    delete: (shiftId: number, platform: string) =>
      void db
        .prepare('DELETE FROM shift_earnings WHERE shift_id = ? AND platform = ?')
        .run(shiftId, platform),
    /** Label totals of one shift per platform (no platform counts under `other`). */
    labelBreakdown: (shiftId: number) =>
      db
        .prepare(
          `SELECT coalesce(platform, 'other') AS platform, sum(payout_cents) AS payoutCents, sum(tip_cents) AS tipCents,
                  sum(role = 'dropoff') AS dropoffs
             FROM stop_labels WHERE shift_id = ? AND (payout_cents > 0 OR tip_cents > 0)
            GROUP BY 1 ORDER BY 1`,
        )
        .all(shiftId) as {
        platform: string;
        payoutCents: number;
        tipCents: number;
        dropoffs: number;
      }[],
    /**
     * Earnings of ended and finalized shifts in `[from, to]`: a typed row is the figure of its
     * (shift, platform); otherwise the sum of that platform's labels. An empty list means nothing
     * was entered or labelled, never zero (18 section 4.3).
     */
    effective(userId: number, from: string, to: string, o: EffectiveOptions): EffectiveRow[] {
      const out = new Map<string, EffectiveRow>();
      if (o.labels) {
        const rows = db
          .prepare(
            `SELECT s.id AS shiftId, s.local_date AS localDate, coalesce(l.platform, 'other') AS platform,
                    sum(l.payout_cents) AS gross, sum(l.tip_cents) AS tips, sum(l.role = 'dropoff') AS drops
               FROM stop_labels l JOIN shifts s ON s.id = l.shift_id
              WHERE s.user_id = ? AND s.status IN ('ended','finalized') AND s.local_date BETWEEN ? AND ?
                AND (l.payout_cents > 0 OR l.tip_cents > 0)
              GROUP BY s.id, 3`,
          )
          .all(userId, from, to) as {
          shiftId: number;
          localDate: string;
          platform: string;
          gross: number;
          tips: number;
          drops: number;
        }[];
        for (const r of rows) {
          out.set(`${r.shiftId}|${r.platform}`, {
            shiftId: r.shiftId,
            localDate: r.localDate,
            platform: r.platform,
            grossCents: r.gross,
            tipsCents: r.tips,
            bonusCents: 0,
            feesCents: 0,
            adjustmentsCents: 0,
            taxWithheldCents: 0,
            orders: r.drops > 0 ? r.drops : null,
            onlineMin: null,
            source: 'labels',
          });
        }
      }
      if (o.entries) {
        const rows = db
          .prepare(
            `SELECT s.id AS shiftId, s.local_date AS localDate, e.platform, e.orders,
                    e.online_min AS onlineMin, ${SUMS}
               FROM shift_earnings e JOIN shifts s ON s.id = e.shift_id
               LEFT JOIN earning_entries x ON x.earnings_id = e.id
              WHERE s.user_id = ? AND s.status IN ('ended','finalized') AND s.local_date BETWEEN ? AND ?
              GROUP BY e.id`,
          )
          .all(userId, from, to) as (EntrySums & {
          shiftId: number;
          localDate: string;
          platform: string;
          orders: number | null;
          onlineMin: number | null;
        })[];
        for (const r of rows) {
          const key = `${r.shiftId}|${r.platform}`;
          const label = out.get(key);
          const add = o.override === 'sum' && label;
          out.set(key, {
            shiftId: r.shiftId,
            localDate: r.localDate,
            platform: r.platform,
            grossCents: r.grossCents + (add ? label.grossCents : 0),
            tipsCents: r.tipsCents + (add ? label.tipsCents : 0),
            bonusCents: r.bonusCents,
            feesCents: r.feesCents,
            adjustmentsCents: r.adjustmentsCents,
            taxWithheldCents: r.taxWithheldCents,
            orders: r.orders ?? (add ? label.orders : null),
            onlineMin: r.onlineMin,
            source: add ? 'mixed' : 'entered',
          });
        }
      }
      return [...out.values()].filter((r) => o.platform === undefined || r.platform === o.platform);
    },
  };
}
export type EarningsRepository = ReturnType<typeof createEarningsRepository>;
