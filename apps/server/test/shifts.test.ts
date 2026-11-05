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

test('minimal end is idempotent, refuses an end before the start, and frees the slot', async () => {
  await start();
  const t0 = h.clock.t;
  expect((await web('POST', `/shifts/${A}/end`, { ended_at: t0 - 1 })).statusCode).toBe(422);
  h.clock.t += 3600_000;
  const end = await web('POST', `/shifts/${A}/end`, { ended_at: h.clock.t });
  expect(end.json()).toMatchObject({ status: 'ended', ended_at: h.clock.t, total_m: 0 });
  const again = await web('POST', '/shifts/1/end', { ended_at: h.clock.t - 5 });
  expect(again.json().ended_at).toBe(h.clock.t);
  expect((await start(B)).statusCode).toBe(201);
  const ghost = `/shifts/00000000-0000-4000-8000-000000000000/end`;
  expect((await web('POST', ghost, { ended_at: 1 })).json().code).toBe('shift_not_found');
});

test('patch: last writer wins on the client edit time, ties go to the server', async () => {
  await start();
  const patch = (body: object) => web('PATCH', '/shifts/1', body);
  const newer = await patch({ notes: 'rainy', updated_at: h.clock.t + 1000 });
  expect([newer.headers['x-milewage-applied'], newer.json().notes]).toEqual(['true', 'rainy']);
  for (const at of [h.clock.t + 1000, h.clock.t + 500]) {
    const stale = await patch({ notes: 'stale', updated_at: at });
    expect([stale.statusCode, stale.headers['x-milewage-applied'], stale.json().notes]).toEqual([
      200,
      'false',
      'rainy',
    ]);
  }
  expect((await patch({ notes: null })).json().notes).toBeNull(); // web edits carry no clock
  expect((await patch({ vehicle_id: 9 })).statusCode).toBe(422);
  h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
  expect((await patch({ notes: 'x' })).json().code).toBe('shift_finalized');
});

test('odometer PUT upserts on (shift, kind) with the same last-writer rule', async () => {
  await start();
  const put = (kind: string, reading_m: number, at: number) =>
    web('PUT', `/shifts/${A}/odometer/${kind}`, { reading_m, recorded_at: at });
  const first = await put('shift_start', 120_000_000, h.clock.t);
  expect(first.json()).toEqual({
    id: 1,
    vehicle_id: 1,
    shift_id: 1,
    kind: 'shift_start',
    reading_m: 120_000_000,
    recorded_at: h.clock.t,
  });
  const stale = await put('shift_start', 1, h.clock.t);
  expect([stale.headers['x-milewage-applied'], stale.json().reading_m]).toEqual([
    'false',
    120_000_000,
  ]);
  const fix = await put('shift_start', 120_000_500, h.clock.t + 1);
  expect([fix.headers['x-milewage-applied'], fix.json().id]).toEqual(['true', 1]);
  expect((await put('shift_end', 120_050_000, h.clock.t + 2)).json().id).toBe(2);
  expect((await put('year_start', 1, 1)).statusCode).toBe(422);
  expect(h.db.prepare('SELECT count(*) FROM odometer_readings').pluck().get()).toBe(2);
});

test('list: newest first, cursor pages, filters', async () => {
  for (let i = 0; i < 5; i++) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await start(id, { started_at: h.clock.t - (5 - i) * DAY });
    await web('POST', `/shifts/${id}/end`, { ended_at: h.clock.t - (5 - i) * DAY + 3600_000 });
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
  await web('POST', `/shifts/${A}/end`, { ended_at: h.clock.t - 19 * DAY });
  await start(B, { started_at: h.clock.t - 13 * DAY });
  await web('POST', `/shifts/${B}/end`, { ended_at: h.clock.t - 12 * DAY });
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
