// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { messageOf } from '../src/pages/Notifications';
import { renderApp, settingsFixture, signedIn } from './support/kit';

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
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    await waitFor(() =>
      expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ read: true }),
    );
    expect(await screen.findByRole('button', { name: 'Mark unread' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(await screen.findByText('Nothing new.')).toBeTruthy();
  });

  it('the Alerts card on Settings flips a toggle', async () => {
    const s = open('/settings');
    fireEvent.click(await screen.findByLabelText('Tax dates'));
    await waitFor(() =>
      expect(
        s.calls.find((c) => c.method === 'PATCH' && c.path === '/notifications/prefs')?.body,
      ).toEqual({ tax_deadlines: false }),
    );
  });

  it('is absent when the module is off: no screen, no count, no card, no call', async () => {
    const s = open('/settings', [item()], false);
    await screen.findByLabelText('Currency');
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
