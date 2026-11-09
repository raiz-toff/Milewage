// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { messageOf } from '../src/notifications';
import { renderApp, settingsFixture, signedIn, menu, openMenu } from './support/kit';

afterEach(cleanup);

const item = (over: object = {}) => ({
  id: 1,
  kind: 'tax_deadline',
  body_key: 'tax_deadline.instalment',
  ref: '2027-03-15',
  created_at: 1_700_000_000_000,
  read_at: null,
  ...over,
});
const prefs = {
  shift_reminders: true,
  goals: true,
  tax_deadlines: true,
  streak: true,
  backup: true,
  sync_reminder: true,
};

function open(url: string, list: object[] = [item()], enabled = true) {
  let rows = list;
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { notifications: enabled } })),
      'GET /notifications': ({ url: u }) => ({
        body: {
          items: rows,
          next_cursor: null,
          unread_count: rows.filter((r) => (r as { read_at: unknown }).read_at === null).length,
          ...(u.searchParams.get('unread') ? {} : {}),
        },
      }),
      'PATCH /notifications/1': () => {
        rows = rows.map((r) => ({ ...r, read_at: 5 }));
        return { body: rows[0] };
      },
      'DELETE /notifications/1': () => {
        rows = [];
        return { status: 204 };
      },
      'GET /notifications/prefs': () => ({ body: prefs }),
      'PATCH /notifications/prefs': ({ body }) => ({ body: { ...prefs, ...(body as object) } }),
    },
    url,
  );
}

describe('notifications (module notifications)', () => {
  it('shows the unread count in the navigation, builds the text from the kind, marks read and dismisses', async () => {
    const s = open('/notifications');
    expect(
      await screen.findByText(/A tax date is coming up: 2027-03-15 \(instalment\)/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Notifications (1)' })).toBeTruthy();
    menu(/tax date/, 'Mark read');
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ read: true }),
    );
    await waitFor(() => expect(screen.queryByText(/tax date/)?.className).toMatch(/muted/));
    openMenu(/tax date/);
    expect(screen.getByRole('menuitem', { name: 'Mark unread' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dismiss' }));
    expect(await screen.findByText('Nothing new.')).toBeTruthy();
  });

  it('shows 50 at a time: Show more adds the older ones and goes at the end', async () => {
    const rows = Array.from({ length: 70 }, (_, i) =>
      item({ id: 70 - i, ref: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, read_at: 5 }),
    );
    const s = renderApp(
      {
        ...signedIn(settingsFixture({ modules: { notifications: true } })),
        'GET /notifications': ({ url }) => {
          if (url.searchParams.get('unread'))
            return { body: { items: [], next_cursor: null, unread_count: 0 } };
          const from = Number(url.searchParams.get('cursor') ?? 0);
          const to = from + Number(url.searchParams.get('limit') ?? 50);
          return {
            body: {
              items: rows.slice(from, to),
              next_cursor: to < rows.length ? String(to) : null,
              unread_count: 0,
            },
          };
        },
      },
      '/notifications',
    );
    const shown = () => screen.queryAllByText(/A tax date is coming up/).length;
    await waitFor(() => expect(shown()).toBe(50));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(shown()).toBe(70));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    const asked = s.calls.filter((c) => c.path === '/notifications' && !/unread/.test(c.query));
    expect(asked.map((c) => c.query)).toEqual(['?limit=50', '?limit=100']);
  });

  it('the Alerts card on Settings flips a toggle', async () => {
    const s = open('/settings/alerts');
    fireEvent.click(await screen.findByLabelText('Tax dates'));
    expect(screen.getByLabelText('Shifts not yet sent (on the phone)')).toBeTruthy();
    await waitFor(() =>
      expect(
        s.calls.find((c) => c.method === 'PATCH' && c.path === '/notifications/prefs')?.body,
      ).toEqual({ tax_deadlines: false }),
    );
  });

  it('is absent when the module is off: no screen, no count, no card, no call', async () => {
    const s = open('/settings/alerts', [item()], false);
    await screen.findByLabelText('Name');
    const sections = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByRole('link', { name: 'Alerts' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/notifications'))).toBe(false);
  });

  it('every kind has words', () => {
    for (const kind of [
      'tax_deadline',
      'recurring_expense_due',
      'goal_met',
      'backup_failed',
      'backup_overdue',
      'badge',
      'level_up',
      'challenge',
      'streak_freeze',
      'streak_risk',
      'shift_reminder',
    ]) {
      expect(messageOf({ kind, body_key: kind, ref: 'x' } as never).length).toBeGreaterThan(5);
    }
  });
});
