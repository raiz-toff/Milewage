import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

// 18 section 11: the in-app inbox. Triggers are evaluated when it is read; the clock only moves forward.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  h.clock.t = Date.parse('2027-03-05T18:00:00Z'); // sessions last 30 days, so every test stays close to this
  ({ cookie } = await h.signUp());
  await send('PATCH', '/settings', { country: 'CA' });
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const inbox = async (q = '') => (await send('GET', `/notifications${q}`)).json();
const kinds = async () =>
  (await inbox()).items.map((n: { kind: string; ref: string }) => `${n.kind}:${n.ref}`).sort();
const at = (iso: string) => (h.clock.t = Date.parse(iso));
const BACKUP_OK = { trigger: 'manual', ok: true, ms: 1, bytes: 1, lagMaxMs: 0 } as const;

describe('triggers', () => {
  test('a tax deadline within 10 days, once, and not the ones further away', async () => {
    at('2027-03-10T18:00:00Z');
    h.bus.emit('backup.finished', BACKUP_OK);
    const first = await inbox();
    expect(first.items.filter((n: { kind: string }) => n.kind === 'tax_deadline')).toEqual([
      expect.objectContaining({
        ref: '2027-03-15',
        body_key: 'tax_deadline.instalment',
        read_at: null,
      }),
    ]);
    expect(
      (await inbox()).items.filter((n: { kind: string }) => n.kind === 'tax_deadline'),
    ).toHaveLength(1);
  });

  test('a recurring expense that is due, and a goal that is met', async () => {
    await send('POST', '/expenses', {
      spent_on: '2027-01-01',
      category: 'phone',
      amount_cents: 5000,
      recurrence: 'monthly',
      next_due: '2027-03-01',
    });
    await send('POST', '/goals', {
      label: 'Shifts',
      metric: 'shifts',
      period: 'weekly',
      target: 1,
    });
    const id = (
      await send('POST', '/shifts', {
        client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
        vehicle_id: 1,
        started_at: h.clock.t,
      })
    ).json().id;
    h.db
      .prepare(
        "UPDATE shifts SET status = 'ended', ended_at = started_at + 3600000, local_date = '2027-03-03' WHERE id = ?",
      )
      .run(id);
    expect(await kinds()).toEqual(
      expect.arrayContaining(['goal_met:1:2027-03-01', 'recurring_expense_due:1:2027-03-01']),
    );
  });

  test('backup: a failed run is recorded when it happens; one that has not run in 36 hours is overdue', async () => {
    h.bus.emit('backup.finished', { ...BACKUP_OK, ok: false });
    h.bus.emit('backup.finished', { ...BACKUP_OK, ok: false });
    expect((await kinds()).filter((k: string) => k.startsWith('backup_failed'))).toEqual([
      'backup_failed:2027-03-05',
    ]);
    expect(await kinds()).not.toContain('backup_overdue:2027-03-05');
    at('2027-03-07T12:00:00Z');
    expect(await kinds()).toContain('backup_overdue:2027-03-07');
  });

  test('a module that is off emits nothing: no goal rows without goals, no tax rows without tax', async () => {
    const off = harness({ goals: false, tax: false });
    try {
      off.clock.t = Date.parse('2027-03-05T18:00:00Z');
      const { cookie: c } = await off.signUp();
      await off.call('PATCH', '/settings', { country: 'CA' }, { cookie: c });
      off.clock.t = Date.parse('2027-03-10T18:00:00Z');
      const list = (await off.call('GET', '/notifications', undefined, { cookie: c })).json();
      expect(
        list.items.filter((n: { kind: string }) => ['goal_met', 'tax_deadline'].includes(n.kind)),
      ).toEqual([]);
    } finally {
      await off.close();
    }
  });
});

describe('the toggles and the inbox', () => {
  test('a switched-off kind makes no row; defaults are all on; bad bodies are 422; a phone reads but cannot change', async () => {
    expect((await send('GET', '/notifications/prefs')).json()).toEqual({
      shift_reminders: true,
      goals: true,
      tax_deadlines: true,
      streak: true,
      backup: true,
      sync_reminder: true,
    });
    expect(
      (await send('PATCH', '/notifications/prefs', { tax_deadlines: false })).json().tax_deadlines,
    ).toBe(false);
    at('2027-03-10T18:00:00Z');
    expect((await kinds()).filter((k: string) => k.startsWith('tax_deadline'))).toEqual([]);
    for (const bad of [{}, { nope: true }, { goals: 'yes' }]) {
      expect((await send('PATCH', '/notifications/prefs', bad)).statusCode).toBe(422);
    }
    const phone = await h.pair(cookie);
    expect((await h.call('GET', '/notifications/prefs', undefined, phone.auth)).statusCode).toBe(
      200,
    );
    expect(
      (await h.call('PATCH', '/notifications/prefs', { goals: false }, phone.auth)).statusCode,
    ).toBe(403);
  });

  test('read, unread filter and count, dismiss stays dismissed, cursor pages', async () => {
    at('2027-03-10T18:00:00Z');
    await send('POST', '/expenses', {
      spent_on: '2027-01-01',
      category: 'phone',
      amount_cents: 5000,
      recurrence: 'weekly',
      next_due: '2027-03-01',
    });
    await send('POST', '/expenses', {
      spent_on: '2027-01-01',
      category: 'phone',
      amount_cents: 5000,
      recurrence: 'monthly',
      next_due: '2027-03-02',
    });
    const all = await inbox();
    expect(all.items.length).toBeGreaterThanOrEqual(3);
    expect(all.unread_count).toBe(all.items.length);
    const first = all.items[0];
    const read = await send('PATCH', `/notifications/${first.id}`, { read: true });
    expect(read.json().read_at).toBe(h.clock.t);
    expect((await inbox('?unread=true')).items.map((n: { id: number }) => n.id)).not.toContain(
      first.id,
    );
    expect((await inbox()).unread_count).toBe(all.items.length - 1);
    expect(
      (await send('PATCH', `/notifications/${first.id}`, { read: false })).json().read_at,
    ).toBeNull();

    expect((await send('DELETE', `/notifications/${first.id}`)).statusCode).toBe(204);
    expect((await inbox()).items.map((n: { id: number }) => n.id)).not.toContain(first.id); // gone, and
    expect((await inbox()).items.length).toBe(all.items.length - 1); // not recreated by the next read
    expect((await send('DELETE', `/notifications/${first.id}`)).statusCode).toBe(404);

    const page = await inbox('?limit=1');
    expect(page.items).toHaveLength(1);
    const next = await inbox(`?limit=1&cursor=${page.next_cursor}`);
    expect(next.items[0].id).toBeLessThan(page.items[0].id);
    expect((await send('GET', '/notifications?cursor=!!')).statusCode).toBe(422);
    expect((await send('PATCH', '/notifications/999', { read: true })).statusCode).toBe(404);
  });
});

describe('module off', () => {
  test('without notifications: no routes and the flag is false', async () => {
    const off = harness({ notifications: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', '/notifications', undefined, { cookie: c })).statusCode).toBe(
        404,
      );
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.notifications,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
