import { EmptyState, PageHeader } from '../ui/layout';
import { Mail, MailOpen, X } from 'lucide-react';
import { RowMenu } from '../ui/RowMenu';
import { ShowMore } from '../ui/ShowMore';
import { unwrap } from '../api/client';
import { usePagedList } from '../api/paged';
import { errorText, put, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';
import { messageOf } from '../notifications';

type Item = Schemas['Notification'];
type Prefs = Schemas['NotificationPrefs'];

/** Notifications (module `notifications`, 18 section 11): the in-app inbox. */
export function NotificationsPage() {
  const { api } = useSession();
  const { timezone } = useSettings();
  // Read 50 at a time, newest first.
  const asked = usePagedList(['/notifications', {}], ({ limit, cursor }, signal) =>
    unwrap(
      api.GET('/notifications', {
        params: { query: { limit, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    ),
  );
  const items = asked.items;
  const change = useChange();
  const error = errorText(change, asked);
  const read = (n: Item) =>
    change.run((api) =>
      api.PATCH('/notifications/{id}', {
        params: { path: { id: n.id } },
        body: { read: n.read_at === null },
      }),
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
                      void change.run((api) =>
                        api.DELETE('/notifications/{id}', { params: { path: { id: n.id } } }),
                      ),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <ShowMore more={asked.more} busy={asked.loadingMore} onClick={asked.showMore} />
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
  const asked = useApiQuery('/notifications/prefs');
  const prefs = asked.data ?? null;
  const change = useChange();
  const error = errorText(change, asked);
  // The answer is the new preferences: shown at once, not asked for again.
  const toggle = (key: keyof Prefs, value: boolean) =>
    change.run(
      (api) => api.PATCH('/notifications/prefs', { body: { [key]: value } }),
      (next) => [put('/notifications/prefs', undefined, next)],
    );
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
