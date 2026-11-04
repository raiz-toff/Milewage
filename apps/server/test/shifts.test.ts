import { afterEach, beforeEach, expect, test } from 'vitest';
import { harness, type Harness } from './support';

const DAY = 86_400_000;
const A = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
const B = '7f1d2c3e-1111-4222-8333-944455556666';
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
});
afterEach(() => h.close());

const web = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const start = (client_id = A, extra: object = {}, headers: object = { cookie }) =>
  h.call('POST', '/shifts', { client_id, vehicle_id: 1, started_at: h.clock.t, ...extra }, headers);
const finish = (id: string) =>
  h.db.prepare("UPDATE shifts SET status = 'ended' WHERE client_id = ?").run(id);
const rows = () => h.db.prepare('SELECT count(*) FROM shifts').pluck().get();

test('start is idempotent on client_id and returns the row unchanged on replay', async () => {
  const first = await start();
  expect(first.statusCode).toBe(201);
  expect(first.json()).toMatchObject({
    id: 1,
    client_id: A,
    status: 'active',
    segmenter: 'stops',
    total_m: null,
    updated_at: h.clock.t,
    flags: [],
  });
  const replay = await start(A.toUpperCase(), { started_at: h.clock.t - 5000 });
  expect([replay.statusCode, replay.json()]).toEqual([200, first.json()]);
  expect(rows()).toBe(1);
});

test('one active shift; 409 carries it; local date uses the instance time zone', async () => {
  const first = (
    await start(A, { started_at: Date.UTC(2027, 0, 15, 3, 30), segmenter: 'whole_shift' })
  ).json();
  expect([first.local_date, first.segmenter]).toEqual(['2027-01-14', 'whole_shift']); // Chicago
  const clash = await start(B);
  expect([clash.statusCode, clash.json().code, clash.json().active_shift.id]).toEqual([
    409,
    'shift_already_active',
    1,
  ]);
  const bad = [{ vehicle_id: 9 }, { started_at: h.clock.t + 6 * 60_000 }];
  for (const extra of bad) expect((await start(B, extra)).statusCode).toBe(422);
  expect((await start(B, { user_id: 3 })).statusCode).toBe(422);
});

test('list: newest first, cursor pages, filters', async () => {
  for (let i = 0; i < 5; i++) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await start(id, { started_at: h.clock.t - (5 - i) * DAY });
    finish(id);
  }
  const page1 = (await web('GET', '/shifts?limit=2')).json();
  expect(page1.items.map((s: { id: number }) => s.id)).toEqual([5, 4]);
  const page2 = (await web('GET', `/shifts?limit=2&cursor=${page1.next_cursor}`)).json();
  expect(page2.items.map((s: { id: number }) => s.id)).toEqual([3, 2]);
  const last = (await web('GET', `/shifts?limit=2&cursor=${page2.next_cursor}`)).json();
  expect([last.items.length, last.next_cursor]).toEqual([1, null]);
  expect((await web('GET', '/shifts?cursor=garbage')).statusCode).toBe(422);
  expect((await web('GET', '/shifts?status=active')).json().items).toEqual([]);
  const day = (await web('GET', '/shifts?from=2027-01-13&to=2027-01-13')).json().items;
  expect(day.map((s: { id: number }) => s.id)).toEqual([4]);
});

test('a device sees only shifts from the last 14 days or ones it wrote to', async () => {
  const { auth } = await h.pair(cookie);
  await start(A, { started_at: h.clock.t - 20 * DAY });
  finish(A);
  await start(B, { started_at: h.clock.t - 13 * DAY });
  finish(B);
  const dev = (method: string, url: string, payload?: object) =>
    h.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: auth, payload });

  const listed = (await dev('GET', '/shifts')).json().items.map((s: { id: number }) => s.id);
  expect(listed).toEqual([2]);
  expect((await dev('GET', '/shifts/1')).json().code).toBe('shift_not_found');
  expect((await dev('PATCH', `/shifts/${A}`, { notes: 'x' })).statusCode).toBe(404);
  expect((await web('GET', '/shifts')).json().items.length).toBe(2); // the web sees everything

  // A phone uploading a 3-week-old shift can read it back: its own write widens the window.
  const old = '11111111-1111-4111-8111-111111111111';
  const made = await dev('POST', '/shifts', {
    client_id: old,
    vehicle_id: 1,
    started_at: h.clock.t - 21 * DAY,
  });
  expect(made.statusCode).toBe(201);
  expect((await dev('GET', `/shifts/${old}`)).statusCode).toBe(200);
  h.clock.t += 15 * DAY;
  expect((await dev('GET', `/shifts/${old}`)).statusCode).toBe(404);
});
