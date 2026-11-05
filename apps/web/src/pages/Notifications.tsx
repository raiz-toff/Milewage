import { useCallback, useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
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
export function useUnread(enabled: boolean, refreshKey = 0): number {
  const { api } = useSession();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void unwrap<Schemas['NotificationPage']>(
      api.GET('/notifications', { params: { query: { unread: true, limit: 1 } } }),
    )
      .then((p) => live && setN(p.unread_count))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, enabled, refreshKey]);
  return n;
}

/** Notifications (module `notifications`, 18 section 11): the in-app inbox. */
export function NotificationsPage() {
  const { api } = useSession();
  const { timezone } = useSettings();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await unwrap<Schemas['NotificationPage']>(api.GET('/notifications'))).items);
    } catch (e) {
      setError(describe(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

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
    <section className="space-y-4">
      <h1 className="font-heading text-2xl">Notifications</h1>
      <FormError message={error} />
      {items === null ? (
        <p className="text-muted">Loading</p>
      ) : items.length === 0 ? (
        <p className="text-muted">Nothing new.</p>
      ) : (
        <ul className="max-w-2xl space-y-2">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded border border-line p-3">
              <div className="flex-1">
                <p className={n.read_at === null ? '' : 'text-muted'}>{messageOf(n)}</p>
                <p className="text-xs text-muted">{formatDateTime(n.created_at, timezone)}</p>
              </div>
              <button
                type="button"
                className="text-sm text-muted hover:text-ink"
                onClick={() => void read(n)}
              >
                {n.read_at === null ? 'Mark read' : 'Mark unread'}
              </button>
              <button
                type="button"
                className="text-sm text-muted hover:text-ink"
                aria-label={`Dismiss: ${messageOf(n)}`}
                onClick={() =>
                  void act(() =>
                    unwrap(api.DELETE('/notifications/{id}', { params: { path: { id: n.id } } })),
                  )
                }
              >
                Dismiss
              </button>
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
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void unwrap<Prefs>(api.GET('/notifications/prefs'))
      .then(setPrefs)
      .catch((e) => setError(describe(e)));
  }, [api]);
  async function toggle(key: keyof Prefs, value: boolean) {
    setError(null);
    try {
      setPrefs(await unwrap<Prefs>(api.PATCH('/notifications/prefs', { body: { [key]: value } })));
    } catch (e) {
      setError(describe(e));
    }
  }
  return (
    <section aria-label="Alerts" className="space-y-2">
      <h2 className="font-heading text-lg">Alerts</h2>
      <FormError message={error} />
      {prefs
        ? LABELS.map(([k, text]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--mw-accent)]"
                checked={prefs[k]}
                onChange={(e) => void toggle(k, e.target.checked)}
              />
              {text}
            </label>
          ))
        : null}
    </section>
  );
}
