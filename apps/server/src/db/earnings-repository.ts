import type { Db } from './open';

export interface EarningsRow {
  id: number;
  userId: number;
  shiftId: number;
  platform: string;
  grossCents: number;
  tipsCents: number;
  bonusCents: number;
  orders: number | null;
  onlineMin: number | null;
  notes: string | null;
  source: 'manual' | 'import';
  editedAt: number;
}

const COLUMNS =
  'id, user_id AS userId, shift_id AS shiftId, platform, gross_cents AS grossCents, tips_cents AS tipsCents, bonus_cents AS bonusCents, orders, online_min AS onlineMin, notes, source, edited_at AS editedAt';

/** A figure per shift and platform after the override rule (18 section 4.3). */
export interface EffectiveRow {
  shiftId: number;
  localDate: string;
  platform: string;
  grossCents: number;
  tipsCents: number;
  bonusCents: number;
  orders: number | null;
  onlineMin: number | null;
  /** Where the figure comes from; `mixed` only under the `sum` rule. */
  source: 'labels' | 'entered' | 'mixed';
}

export const totalOf = (r: Pick<EffectiveRow, 'grossCents' | 'tipsCents' | 'bonusCents'>) =>
  r.grossCents + r.tipsCents + r.bonusCents;

export interface EffectiveOptions {
  /** Count the driver's stop labels (module `stops` on and the setting on). */
  labels: boolean;
  /** Count the typed entries (module `earnings` on). */
  entries: boolean;
  override: 'replace' | 'sum';
  platform?: string;
}

/** The driver-entered earnings (module `earnings`). */
export function createEarningsRepository(db: Db) {
  return {
    ofShift: (shiftId: number): EarningsRow[] =>
      db
        .prepare(`SELECT ${COLUMNS} FROM shift_earnings WHERE shift_id = ? ORDER BY platform`)
        .all(shiftId) as EarningsRow[],
    find: (shiftId: number, platform: string): EarningsRow | undefined =>
      db
        .prepare(`SELECT ${COLUMNS} FROM shift_earnings WHERE shift_id = ? AND platform = ?`)
        .get(shiftId, platform) as EarningsRow | undefined,
    put(r: Omit<EarningsRow, 'id'>) {
      db.prepare(
        `INSERT INTO shift_earnings (user_id, shift_id, platform, gross_cents, tips_cents, bonus_cents, orders, online_min, notes, source, edited_at)
         VALUES (@userId, @shiftId, @platform, @grossCents, @tipsCents, @bonusCents, @orders, @onlineMin, @notes, @source, @editedAt)
         ON CONFLICT (shift_id, platform) DO UPDATE SET gross_cents = @grossCents, tips_cents = @tipsCents,
           bonus_cents = @bonusCents, orders = @orders, online_min = @onlineMin, notes = @notes,
           source = @source, edited_at = @editedAt`,
      ).run(r);
    },
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
            orders: r.drops > 0 ? r.drops : null,
            onlineMin: null,
            source: 'labels',
          });
        }
      }
      if (o.entries) {
        const rows = db
          .prepare(
            `SELECT s.id AS shiftId, s.local_date AS localDate, e.platform, e.gross_cents AS gross,
                    e.tips_cents AS tips, e.bonus_cents AS bonus, e.orders, e.online_min AS onlineMin
               FROM shift_earnings e JOIN shifts s ON s.id = e.shift_id
              WHERE s.user_id = ? AND s.status IN ('ended','finalized') AND s.local_date BETWEEN ? AND ?`,
          )
          .all(userId, from, to) as {
          shiftId: number;
          localDate: string;
          platform: string;
          gross: number;
          tips: number;
          bonus: number;
          orders: number | null;
          onlineMin: number | null;
        }[];
        for (const r of rows) {
          const key = `${r.shiftId}|${r.platform}`;
          const label = out.get(key);
          const add = o.override === 'sum' && label;
          out.set(key, {
            shiftId: r.shiftId,
            localDate: r.localDate,
            platform: r.platform,
            grossCents: r.gross + (add ? label.grossCents : 0),
            tipsCents: r.tips + (add ? label.tipsCents : 0),
            bonusCents: r.bonus,
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
