import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakeNotificationBackend, FakeNotifications } from '../src/notifications/fake';
import { createNotifications, REMINDER_CHANNEL } from '../src/notifications/port';
import {
  UNSYNCED_ID,
  UNSYNCED_KEY,
  UNSYNCED_TITLE,
  UnsyncedReminders,
} from '../src/notifications/unsynced';
import { MemoryStore } from '../src/pairing/pairing';
import { FakePermissions } from '../src/permissions/fake';
import { REMINDER_SHOWN_KEY } from '../src/sync/status';
import { json, problem } from './support/mock';
import { server, setup, SHIFT } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const DAY = 86_400_000;

describe('createNotifications: gated by the ladder, never asks', () => {
  it('granted: shows, schedules and cancels on the Reminders channel', async () => {
    const backend = new FakeNotificationBackend();
    const permissions = new FakePermissions({ notifications: 'granted' });
    const port = createNotifications({ permissions, backend });
    await expect(port.granted()).resolves.toBe(true);
    await port.show('a', 'T', 'B');
    await port.schedule('a', 5_000, 'T', 'B2');
    await port.cancel('a');
    expect(backend.presented).toEqual([
      { id: 'a', title: 'T', body: 'B', channelId: 'milewage_reminders' },
    ]);
    expect(backend.scheduled).toEqual([
      { id: 'a', title: 'T', body: 'B2', channelId: 'milewage_reminders', atMs: 5_000 },
    ]);
    expect(backend.cancelled).toEqual(['a']);
    expect(REMINDER_CHANNEL).toEqual({
      id: 'milewage_reminders',
      name: 'Reminders',
      importance: 'default',
    });
    expect(permissions.requests).toEqual([]);
  });

  it.each(['denied', 'blocked', 'undetermined'] as const)(
    'Android 13+ with the permission %s: nothing is shown or scheduled, nothing is asked',
    async (state) => {
      const backend = new FakeNotificationBackend();
      const permissions = new FakePermissions({ notifications: state });
      const port = createNotifications({ permissions, backend });
      await expect(port.granted()).resolves.toBe(false);
      await port.show('a', 'T', 'B');
      await port.schedule('a', 1, 'T', 'B');
      expect(backend.presented).toEqual([]);
      expect(backend.scheduled).toEqual([]);
      expect(permissions.requests).toEqual([]);
      // Cancelling still works, so a reminder from before the permission was turned off goes away.
      await port.cancel('a');
      expect(backend.cancelled).toEqual(['a']);
    },
  );

  it('notifications switched off in system settings count as not granted', async () => {
    const backend = new FakeNotificationBackend();
    backend.on = false;
    const port = createNotifications({
      permissions: new FakePermissions({ notifications: 'granted' }),
      backend,
    });
    await expect(port.granted()).resolves.toBe(false);
    await port.show('a', 'T', 'B');
    expect(backend.presented).toEqual([]);
  });

  it('no backend: never granted; a failing backend or permission read never throws', async () => {
    const none = createNotifications({
      permissions: new FakePermissions({ notifications: 'granted' }),
      backend: null,
    });
    await expect(none.granted()).resolves.toBe(false);
    await none.cancel('a');

    const backend = new FakeNotificationBackend();
    backend.fail = new Error('native');
    const port = createNotifications({
      permissions: new FakePermissions({ notifications: 'granted' }),
      backend,
    });
    await expect(port.show('a', 'T', 'B')).resolves.toBeUndefined();
    await expect(port.schedule('a', 1, 'T', 'B')).resolves.toBeUndefined();
    await expect(port.cancel('a')).resolves.toBeUndefined();

    const broken = new FakePermissions();
    broken.snapshot = () => Promise.reject(new Error('no activity'));
    const p2 = createNotifications({ permissions: broken, backend: new FakeNotificationBackend() });
    await expect(p2.granted()).resolves.toBe(false);
  });
});

describe('unsynced reminder as an OS notification (15 section 4.4)', () => {
  const t0 = 1_000_000_000;
  const make = (now: number) => {
    const port = new FakeNotifications();
    const plain = new MemoryStore();
    const clock = { t: now };
    const r = new UnsyncedReminders({ port, plain, now: () => clock.t });
    return { port, plain, clock, r };
  };
  const pending = (n: number, oldestAt = t0) => ({ oldestAt, unsyncedShifts: n });

  it('before 3 days: one reminder scheduled for the 3-day mark, nothing shown', async () => {
    const { port, r } = make(t0 + DAY);
    await r.update(pending(2));
    expect(port.showing.size).toBe(0);
    expect(port.pending.get(UNSYNCED_ID)).toEqual({
      atMs: t0 + 3 * DAY,
      title: UNSYNCED_TITLE,
      body: '2 shifts are only on this phone. Open MileWage when you reach your server.',
    });
  });

  it('the same state again schedules nothing new (dedupe)', async () => {
    const { port, r, clock } = make(t0 + DAY);
    await r.update(pending(2));
    clock.t += 60_000;
    await r.update(pending(2));
    await r.update(pending(2));
    expect(port.calls).toEqual([`schedule ${UNSYNCED_ID}`]);
  });

  it('due now with no reminder today: shows one, then schedules the next a day later', async () => {
    const { port, r, plain } = make(t0 + 3 * DAY);
    await r.update(pending(1));
    expect(port.showing.get(UNSYNCED_ID)?.body).toMatch(/^1 shift is only on this phone/);
    expect(port.pending.get(UNSYNCED_ID)?.atMs).toBe(t0 + 4 * DAY);
    // Run again an hour later: already reminded today, so no second notification.
    const before = port.calls.length;
    await r.update(pending(1));
    expect(port.calls.length).toBe(before);
    expect(JSON.parse((await plain.get(UNSYNCED_KEY))!).shownAt).toBe(t0 + 3 * DAY);
  });

  it('the banner showed it today: no OS notification now, the next one tomorrow', async () => {
    const { port, r, plain } = make(t0 + 3 * DAY);
    await plain.set(REMINDER_SHOWN_KEY, String(t0 + 3 * DAY));
    await r.update(pending(1));
    expect(port.showing.size).toBe(0);
    expect(port.pending.get(UNSYNCED_ID)?.atMs).toBe(t0 + 4 * DAY);
  });

  it('a pending reminder whose time has passed counts as shown: at most one a day', async () => {
    const { port, r, clock } = make(t0 + DAY);
    await r.update(pending(2));
    // The scheduled one fired at day 3 while the app was closed; the app opens 2 hours later.
    clock.t = t0 + 3 * DAY + 2 * 3_600_000;
    await r.update(pending(2));
    expect(port.showing.size).toBe(0);
    expect(port.pending.get(UNSYNCED_ID)?.atMs).toBe(t0 + 4 * DAY);
  });

  it('from 7 days the scheduled words are the stronger ones', async () => {
    const { port, r } = make(t0 + 6 * DAY + 1);
    await r.update(pending(3));
    // Shown now (normal words) and the next, at 7 days, scheduled with the stronger words.
    expect(port.showing.get(UNSYNCED_ID)?.body).toMatch(/^3 shifts are only on this phone\. /);
    const next = port.pending.get(UNSYNCED_ID)!;
    expect(next.atMs).toBe(t0 + 7 * DAY + 1);
    expect(next.body).toMatch(/for 7 days\. If the phone is lost they are gone/);
  });

  it('nothing pending: cancels the pending and the shown one, once', async () => {
    const { port, r, plain } = make(t0 + 3 * DAY);
    await r.update(pending(1));
    expect(port.showing.size).toBe(1);
    await r.update({ oldestAt: null, unsyncedShifts: 0 });
    expect(port.showing.size).toBe(0);
    expect(port.pending.size).toBe(0);
    expect(await plain.get(UNSYNCED_KEY)).toBeNull();
    await r.update({ oldestAt: null, unsyncedShifts: 0 });
    expect(port.calls.filter((c) => c.startsWith('cancel'))).toEqual([`cancel ${UNSYNCED_ID}`]);
  });

  it('no permission: nothing is shown, scheduled or stored; the banner stays the only channel', async () => {
    const { port, r, plain } = make(t0 + 5 * DAY);
    port.allowed = false;
    await r.update(pending(4));
    expect(port.calls).toEqual([]);
    expect(await plain.get(UNSYNCED_KEY)).toBeNull();
  });
});

describe('home banner keeps the OS reminder in step', () => {
  it('schedules while a shift waits, cancels once everything is on the server', async () => {
    let down = true;
    const routes = server({
      'POST /shifts': () => (down ? problem(503, 'x', true) : json(201, SHIFT)),
    });
    const notifications = new FakeNotifications();
    const { services } = setup(routes, { paired: true, notifications });
    await services.shift.start({ vehicleId: 3 });
    await services.shift.end();
    render(<App services={services} />);
    expect(await screen.findByText(/Not yet on server: 1 shift/)).toBeTruthy();
    await waitFor(() => expect(notifications.pending.get(UNSYNCED_ID)).toBeDefined());

    down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(notifications.calls).toContain(`cancel ${UNSYNCED_ID}`));
    expect(notifications.pending.size).toBe(0);
  });
});
