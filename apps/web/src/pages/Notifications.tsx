import { useState } from 'react';
import { EmptyState, PageHeader } from '../ui/layout';
import { Mail, MailOpen, X } from 'lucide-react';
import { RowMenu } from '../ui/RowMenu';
import { describe, unwrap } from '../api/client';
import { useApiQuery, useInvalidate, useSetApiData } from '../api/query';
import type { Schemas } from '../api/client';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';

type Item = Schemas['Notification'];
type Prefs = Schemas['NotificationPrefs'];

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

/** Notifications (module `notifications`, 18 section 11): the in-app inbox. */
export function NotificationsPage() {
  const { api } = useSession();
  const { timezone } = useSettings();
  const asked = useApiQuery('/notifications');
  const items = asked.data?.items ?? null;
  const invalidate = useInvalidate();
  // The unread count in the header is read again with the list.
  const load = () => invalidate('/notifications');
  const [failed, setError] = useState<string | null>(null);
  const error = failed ?? (asked.error ? describe(asked.error) : null);

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }
  const read = (n: Item) =>
    act(() =>
      unwrap(
        api.PATCH('/notifications/{id}', {
          params: { path: { id: n.id } },
          body: { read: n.read_at === null },
        }),
      ),
    );

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Notifications" />
      <FormError message={error} />
      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : items.length === 0 ? (
        <EmptyState>Nothing new.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <span
                aria-hidden="true"
                className={`mt-2 size-2 shrink-0 rounded-full ${n.read_at === null ? 'bg-primary' : 'bg-transparent'}`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className={`text-sm ${n.read_at === null ? 'font-medium' : 'text-muted-foreground'}`}
                >
                  {messageOf(n)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(n.created_at, timezone)}
                </p>
              </div>
              <RowMenu
                name={messageOf(n)}
                actions={[
                  {
                    label: n.read_at === null ? 'Mark read' : 'Mark unread',
                    icon: n.read_at === null ? MailOpen : Mail,
                    onSelect: () => void read(n),
                  },
                  {
                    label: 'Dismiss',
                    icon: X,
                    destructive: true,
                    onSelect: () =>
                      void act(() =>
                        unwrap(
                          api.DELETE('/notifications/{id}', { params: { path: { id: n.id } } }),
                        ),
                      ),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LABELS: [keyof Prefs, string][] = [
  ['shift_reminders', 'Shift reminders (on the phone)'],
  ['goals', 'Goals and progress'],
  ['tax_deadlines', 'Tax dates'],
  ['streak', 'Streak'],
  ['backup', 'Backup problems'],
  ['sync_reminder', 'Unsynced data reminder (on the phone)'],
];

/** Settings card with the toggles of the module. */
export function AlertsCard() {
  const { api } = useSession();
  const asked = useApiQuery('/notifications/prefs');
  const prefs = asked.data ?? null;
  const setData = useSetApiData();
  const setPrefs = (next: Prefs) => setData('/notifications/prefs', undefined, next);
  const [failed, setError] = useState<string | null>(null);
  const error = failed ?? (asked.error ? describe(asked.error) : null);
  async function toggle(key: keyof Prefs, value: boolean) {
    setError(null);
    try {
      setPrefs(await unwrap<Prefs>(api.PATCH('/notifications/prefs', { body: { [key]: value } })));
    } catch (e) {
      setError(describe(e));
    }
  }
  return (
    <section aria-label="Alerts" className="space-y-3">
      <h3 className="text-base leading-snug font-medium">Tell me about</h3>
      <FormError message={error} />
      {prefs ? (
        <ul className="divide-y rounded-lg border">
          {LABELS.map(([k, text]) => (
            <li key={k} className="flex items-center justify-between gap-3 px-3 py-2">
              <label htmlFor={`alert-${k}`} className="text-sm">
                {text}
              </label>
              <Switch
                id={`alert-${k}`}
                checked={prefs[k]}
                onCheckedChange={(on) => void toggle(k, on)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
