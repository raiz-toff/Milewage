import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { harness, type Harness } from './support';

const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  const start = { client_id: SHIFT, vehicle_id: 1, started_at: t0 };
  expect((await h.call('POST', '/shifts', start, auth)).statusCode).toBe(201);
  h.clock.t += 600_000;
});
afterEach(() => h.close());

const pt = (seq: number, extra: object = {}) => ({
  seq,
  recorded_at: t0 + seq * 1000,
  lat_e7: 377749290,
  lon_e7: -1224194160,
  accuracy_m: 5,
  ...extra,
});
const upload = (body: unknown, headers: object = auth, gzip = false) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/telemetry/batch',
    headers: {
      'content-type': 'application/json',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      ...headers,
    },
    payload: gzip ? gzipSync(JSON.stringify(body)) : JSON.stringify(body),
  });
const send = (points: object[], gzip = true) =>
  upload({ shift_client_id: SHIFT, points }, auth, gzip);
const stored = () => h.db.prepare('SELECT count(*) FROM telemetry_points').pluck().get();

test('a batch is idempotent on (device, seq): the replay stores nothing new', async () => {
  const points = [pt(1), pt(2, { speed_dmps: 83, bearing_deg: 270, altitude_m: 15 }), pt(3)];
  const first = await send(points); // gzip, as the phone sends it
  expect(first.json()).toEqual({
    inserted: 3,
    duplicates: 0,
    rejected: [],
    server_time: h.clock.t,
    upload_hint_s: 60,
  });
  const second = await send(points, false);
  expect([second.json().inserted, second.json().duplicates]).toEqual([0, 3]);
  expect((await send([pt(3), pt(4), pt(4)])).json()).toMatchObject({ inserted: 1, duplicates: 2 });
  expect(stored()).toBe(4);
  const shift = h.db.prepare('SELECT device_touched_at FROM shifts').pluck().get();
  expect(shift).toBe(h.clock.t);
});

test('bad points are refused one by one and never fail the batch', async () => {
  const res = await send([
    pt(1),
    pt(2, { lat_e7: 900_000_001 }),
    pt(3, { recorded_at: h.clock.t + 6 * 60_000 }),
    pt(4, { recorded_at: t0 - 6 * 60_000 }),
    pt(5, { accuracy_m: 900 }), // poor accuracy is stored, never refused
  ]);
  expect(res.statusCode).toBe(200);
  expect(res.json().rejected).toEqual([
    { seq: 2, code: 'invalid_coordinate' },
    { seq: 3, code: 'future_timestamp' },
    { seq: 4, code: 'outside_shift_window' },
  ]);
  expect([res.json().inserted, stored()]).toEqual([2, 2]);
  for (const bad of [{ seq: 0 }, { lat_e7: 1.5 }, { colour: 'red' }]) {
    expect((await send([pt(9, bad)])).statusCode).toBe(422);
  }
  expect((await upload({ shift_client_id: SHIFT, points: [] })).statusCode).toBe(422);
});

test('the window after the end is 10 minutes', async () => {
  const ended = h.clock.t;
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: ended }, auth);
  h.clock.t += 20 * 60_000;
  const res = await send([
    pt(1, { recorded_at: ended + 9 * 60_000 }),
    pt(2, { recorded_at: ended + 11 * 60_000 }),
  ]);
  expect([res.json().inserted, res.json().rejected[0].code]).toEqual([1, 'outside_shift_window']);
});

test('size limits: 500 points, 1 MiB decompressed, 256 KiB compressed, gzip only', async () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => pt(i + 1));
  expect((await send(many(500))).json().inserted).toBe(500);
  const over = await send(many(501));
  expect([over.statusCode, over.json().code]).toEqual([413, 'payload_too_large']);
  const bomb = await send(many(12_000)); // a few hundred KiB of gzip, over 1 MiB once expanded
  expect([bomb.statusCode, bomb.json().code]).toEqual([413, 'payload_too_large']);
  expect((await send(many(12_000), false)).statusCode).toBe(413);
  const big = await upload(randomBytes(300 * 1024), { ...auth, 'content-encoding': 'gzip' });
  expect(big.statusCode).toBe(413);
  const corrupt = await upload('not gzip', { ...auth, 'content-encoding': 'gzip' });
  expect([corrupt.statusCode, corrupt.json().code]).toEqual([400, 'malformed_request']);
  const br = await upload({}, { ...auth, 'content-encoding': 'br' });
  expect(br.statusCode).toBe(415);
  expect(stored()).toBe(500);
});

test('who may upload and to what', async () => {
  const body = { shift_client_id: SHIFT, points: [pt(1)] };
  const web = await upload(body, { cookie, origin: 'http://mw.test', host: 'mw.test' });
  expect([web.statusCode, web.json().code]).toEqual([403, 'scope_forbidden']);
  const site = { origin: 'http://mw.test', host: 'mw.test' };
  expect((await upload(body, site)).json().code).toBe('auth_required');
  const ghost = await upload({ ...body, shift_client_id: '11111111-1111-4111-8111-111111111111' });
  expect([ghost.statusCode, ghost.json().code]).toEqual([404, 'shift_not_found']);
  h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
  expect((await upload(body)).json().code).toBe('shift_finalized');
  expect(stored()).toBe(0);
});

test('with the tracking module off the route is absent', async () => {
  const off = harness({ tracking: false });
  const res = await off.app.inject({ method: 'POST', url: '/api/v1/telemetry/batch', payload: {} });
  expect(res.statusCode).toBe(404);
  await off.close();
});
