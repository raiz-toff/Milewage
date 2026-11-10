import type { Db } from './open';

/** One of your mileage rates (ADR 0007), as stored: hundredths of a minor unit per km or mile. */
export interface OwnRateRow {
  id: number;
  /** `YYYY-MM-DD`, or null for "from the start". */
  effectiveFrom: string | null;
  hundredths: number;
  unit: 'km' | 'mi';
  note: string | null;
}

export type NewOwnRate = Omit<OwnRateRow, 'id'>;

const COLUMNS = 'id, effective_from AS effectiveFrom, hundredths, unit, note';

/** Your mileage rates, oldest first (the undated one before every dated one). */
export function createOwnRateRepository(db: Db) {
  const find = (userId: number, id: number) =>
    db
      .prepare(`SELECT ${COLUMNS} FROM own_mileage_rates WHERE user_id = ? AND id = ?`)
      .get(userId, id) as OwnRateRow | undefined;
  return {
    list: (userId: number): OwnRateRow[] =>
      db
        .prepare(
          `SELECT ${COLUMNS} FROM own_mileage_rates WHERE user_id = ?
            ORDER BY effective_from IS NOT NULL, effective_from, id`,
        )
        .all(userId) as OwnRateRow[],
    find,
    /** The rate starting on that day (null: the undated one), other than `except`. */
    onDay: (userId: number, day: string | null, except?: number): OwnRateRow | undefined =>
      db
        .prepare(
          `SELECT ${COLUMNS} FROM own_mileage_rates
            WHERE user_id = ? AND COALESCE(effective_from, '') = ? AND id <> ?`,
        )
        .get(userId, day ?? '', except ?? 0) as OwnRateRow | undefined,
    create(userId: number, r: NewOwnRate, now: number): OwnRateRow {
      const id = db
        .prepare(
          `INSERT INTO own_mileage_rates (user_id, effective_from, hundredths, unit, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, r.effectiveFrom, r.hundredths, r.unit, r.note, now, now).lastInsertRowid;
      return find(userId, Number(id))!;
    },
    update(userId: number, id: number, r: NewOwnRate, now: number): OwnRateRow | undefined {
      db.prepare(
        `UPDATE own_mileage_rates SET effective_from = ?, hundredths = ?, unit = ?, note = ?, updated_at = ?
          WHERE user_id = ? AND id = ?`,
      ).run(r.effectiveFrom, r.hundredths, r.unit, r.note, now, userId, id);
      return find(userId, id);
    },
    delete: (userId: number, id: number): boolean =>
      db.prepare('DELETE FROM own_mileage_rates WHERE user_id = ? AND id = ?').run(userId, id)
        .changes > 0,
  };
}
