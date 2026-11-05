import type { Db } from './open';

export type GoalMetric = 'earnings' | 'hours' | 'shifts' | 'active_distance';
export type GoalPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface GoalRow {
  id: number;
  userId: number;
  label: string;
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;
  active: number;
  createdAt: number;
}

const COLUMNS =
  'id, user_id AS userId, label, metric, period, target, active, created_at AS createdAt';

/** Goals (module `goals`). */
export function createGoalRepository(db: Db) {
  const find = (userId: number, id: number) =>
    db.prepare(`SELECT ${COLUMNS} FROM goals WHERE user_id = ? AND id = ?`).get(userId, id) as
      GoalRow | undefined;
  return {
    find,
    list: (userId: number): GoalRow[] =>
      db
        .prepare(`SELECT ${COLUMNS} FROM goals WHERE user_id = ? ORDER BY id`)
        .all(userId) as GoalRow[],
    create(r: Omit<GoalRow, 'id'>): GoalRow {
      const id = db
        .prepare(
          'INSERT INTO goals (user_id, label, metric, period, target, active, created_at) VALUES (@userId, @label, @metric, @period, @target, @active, @createdAt)',
        )
        .run(r).lastInsertRowid;
      return find(r.userId, Number(id))!;
    },
    update(
      userId: number,
      id: number,
      r: Partial<Pick<GoalRow, 'label' | 'metric' | 'period' | 'target' | 'active'>>,
    ) {
      const keys = Object.keys(r);
      if (keys.length > 0) {
        db.prepare(
          `UPDATE goals SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE user_id = @userId AND id = @id`,
        ).run({
          ...r,
          userId,
          id,
        });
      }
      return find(userId, id);
    },
    delete: (userId: number, id: number): boolean =>
      db.prepare('DELETE FROM goals WHERE user_id = ? AND id = ?').run(userId, id).changes > 0,
  };
}
