import type { Schemas } from './api/client';
import { useApiQuery } from './api/query';

type Item = Schemas['Notification'];

/** The text of a message: built here from the kind and its reference, because the server stores no text (18 section 11). */
export function messageOf(n: Pick<Item, 'kind' | 'body_key' | 'ref'>): string {
  switch (n.kind) {
    case 'tax_deadline':
      return `A tax date is coming up: ${n.ref} (${n.body_key.split('.')[1] ?? 'deadline'}).`;
    case 'recurring_expense_due':
      return 'A repeating expense is due. Add it on the Expenses screen.';
    case 'goal_met':
      return 'You reached one of your goals.';
    case 'backup_failed':
      return `A backup failed on ${n.ref}. Check the Backups screen.`;
    case 'backup_overdue':
      return 'No successful backup in the last day and a half.';
    case 'badge':
      return 'You unlocked a badge.';
    case 'level_up':
      return 'You reached a new level.';
    case 'challenge':
      return 'A weekly challenge was completed.';
    case 'streak_freeze':
      return 'A streak freeze protected your streak.';
    case 'streak_risk':
      return 'Your streak is at risk today.';
    default:
      return 'Reminder';
  }
}

/** The unread count for the navigation; a failure is silent because the count is a convenience. */
export function useUnread(enabled: boolean): number {
  const page = useApiQuery(
    '/notifications',
    { params: { query: { unread: true, limit: 1 } } },
    { enabled },
  ).data;
  return (enabled && page?.unread_count) || 0;
}
