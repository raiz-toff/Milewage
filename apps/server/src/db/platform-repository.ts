import type { Db } from './open';

export interface PlatformRow {
  userId: number;
  slug: string;
  label: string;
  custom: number;
  color: string | null;
  emoji: string | null;
  active: number;
  sort: number;
  hourlyTargetCents: number | null;
}

const COLUMNS =
  'user_id AS userId, slug, label, custom, color, emoji, active, sort, hourly_target_cents AS hourlyTargetCents';

/** The driver's overrides and custom platforms (18 section 4.2). Built-ins live in the shared registry. */
export function createPlatformRepository(db: Db) {
  return {
    list: (userId: number): PlatformRow[] =>
      db
        .prepare(`SELECT ${COLUMNS} FROM platform_settings WHERE user_id = ?`)
        .all(userId) as PlatformRow[],
    find: (userId: number, slug: string): PlatformRow | undefined =>
      db
        .prepare(`SELECT ${COLUMNS} FROM platform_settings WHERE user_id = ? AND slug = ?`)
        .get(userId, slug) as PlatformRow | undefined,
    put(row: PlatformRow) {
      db.prepare(
        `INSERT INTO platform_settings (user_id, slug, label, custom, color, emoji, active, sort, hourly_target_cents)
         VALUES (@userId, @slug, @label, @custom, @color, @emoji, @active, @sort, @hourlyTargetCents)
         ON CONFLICT (user_id, slug) DO UPDATE SET label = @label, custom = @custom, color = @color,
           emoji = @emoji, active = @active, sort = @sort, hourly_target_cents = @hourlyTargetCents`,
      ).run(row);
    },
    delete: (userId: number, slug: string) =>
      void db
        .prepare('DELETE FROM platform_settings WHERE user_id = ? AND slug = ?')
        .run(userId, slug),
    /** True when a label (or, with the earnings module, an earnings row) already uses the slug. */
    inUse(userId: number, slug: string): boolean {
      const tables = [
        'SELECT 1 FROM stop_labels WHERE user_id = ? AND platform = ? LIMIT 1',
        'SELECT 1 FROM shift_earnings WHERE user_id = ? AND platform = ? LIMIT 1',
      ];
      return tables.some((sql) => {
        try {
          return db.prepare(sql).get(userId, slug) !== undefined;
        } catch {
          return false; // the earnings table does not exist before its migration
        }
      });
    },
  };
}
