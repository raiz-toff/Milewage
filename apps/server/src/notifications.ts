import { taxPacks, type ModuleRegistry } from '@milewage/shared';
import type { EventEmit } from './events';
import {
  createBackupRepository,
  createExpenseRepository,
  createGoalRepository,
  createSettingsRepository,
  type Db,
} from './db';
import { goalViewer } from './routes/goals';
import { localDate } from './time';

export type NotificationKind =
  | 'badge'
  | 'challenge'
  | 'level_up'
  | 'streak_freeze'
  | 'streak_risk'
  | 'goal_met'
  | 'tax_deadline'
  | 'shift_reminder'
  | 'backup_overdue'
  | 'backup_failed'
  | 'recurring_expense_due';

export const PREFS = [
  'shift_reminders',
  'goals',
  'tax_deadlines',
  'streak',
  'backup',
  'sync_reminder',
] as const;
export type PrefName = (typeof PREFS)[number];

/** Which toggle silences which kind. Recurring-expense reminders have no toggle: they are the driver's own template. */
const GATE: Record<NotificationKind, PrefName | null> = {
  badge: 'goals',
  challenge: 'goals',
  level_up: 'goals',
  goal_met: 'goals',
  streak_freeze: 'streak',
  streak_risk: 'streak',
  tax_deadline: 'tax_deadlines',
  shift_reminder: 'shift_reminders',
  backup_overdue: 'backup',
  backup_failed: 'backup',
  recurring_expense_due: null,
};

export const prefsOf = (db: Db, userId: number): Record<PrefName, boolean> => {
  const row = db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(userId) as
    Record<string, number> | undefined;
  return Object.fromEntries(PREFS.map((p) => [p, (row?.[p] ?? 1) === 1])) as Record<
    PrefName,
    boolean
  >;
};

export interface NotifyContext {
  db: Db;
  now: () => number;
  emit?: () => EventEmit | undefined;
}

/** One inbox row per dedupe key, and none while the matching toggle is off. Returns true when a row was added. */
export function notify(
  c: NotifyContext,
  userId: number,
  kind: NotificationKind,
  dedupeKey: string,
  bodyKey: string,
): boolean {
  const gate = GATE[kind];
  if (gate && !prefsOf(c.db, userId)[gate]) return false;
  const info = c.db
    .prepare(
      'INSERT OR IGNORE INTO notifications (user_id, kind, dedupe_key, body_key, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, kind, dedupeKey, bodyKey, c.now());
  if (info.changes === 0) return false;
  c.emit?.()?.('notification.created', { notificationId: String(info.lastInsertRowid), kind });
  return true;
}

const DAY = 86_400_000;
const OVERDUE_MS = 36 * 3_600_000;

/**
 * The time-based triggers, evaluated when the inbox is read (no timer of its own: the inbox only
 * matters while someone looks at it, and the phone keeps its own local reminders). Modules that are
 * off emit nothing.
 */
export function evaluate(
  c: NotifyContext & {
    registry: ModuleRegistry;
    taxCountries: readonly string[];
    override?: 'replace' | 'sum';
  },
  userId: number,
) {
  const prefs = createSettingsRepository(c.db).get(userId);
  if (!prefs) return;
  const today = localDate(c.now(), prefs.timezone);
  const inDays = (date: string) =>
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY;

  if (c.registry.isEnabled('tax') && c.taxCountries.includes(prefs.country)) {
    const pack = taxPacks.get(prefs.country);
    const year = Number(today.slice(0, 4));
    for (const d of [...(pack?.deadlines(year - 1) ?? []), ...(pack?.deadlines(year) ?? [])]) {
      if (inDays(d.date) >= 0 && inDays(d.date) <= 10)
        notify(c, userId, 'tax_deadline', `tax_deadline:${d.date}`, `tax_deadline.${d.kind}`);
    }
  }
  if (c.registry.isEnabled('expenses')) {
    for (const e of createExpenseRepository(c.db).due(userId, today)) {
      notify(
        c,
        userId,
        'recurring_expense_due',
        `recurring_expense_due:${e.id}:${e.nextDue}`,
        'recurring_expense_due',
      );
    }
  }
  if (c.registry.isEnabled('goals')) {
    const view = goalViewer({ db: c.db, now: c.now, registry: c.registry, override: c.override });
    for (const g of createGoalRepository(c.db).list(userId)) {
      if (g.active !== 1) continue;
      const p = view(userId, g).progress;
      if (p.ratio !== null && p.ratio >= 1)
        notify(c, userId, 'goal_met', `goal_met:${g.id}:${p.period_from}`, 'goal_met');
    }
  }
  const lastGood = createBackupRepository(c.db)
    .list()
    .find((r) => r.integrityOk === 1)?.createdAt;
  const confirmed = c.db
    .prepare('SELECT setup_confirmed_at FROM instance WHERE id = 1')
    .pluck()
    .get() as number | null | undefined;
  if (
    confirmed != null &&
    (lastGood === undefined ? c.now() - confirmed > OVERDUE_MS : c.now() - lastGood > OVERDUE_MS)
  ) {
    notify(c, userId, 'backup_overdue', `backup_overdue:${today}`, 'backup_overdue');
  }
}
