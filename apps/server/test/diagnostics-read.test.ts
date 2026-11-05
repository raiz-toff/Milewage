import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
const T0 = 1_800_000_000_000;
const SHIFT_A = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';

const upload = (seq: number, at: number, extra: object = {}) => ({
  kind: 'upload.window',
  at,
  level: 'basic',
  src: 'phone_js',
  seq,
  v: '0.1.0',
  data: {
    attempts: 3,
    ok: 3,
    fail_net: 0,
    fail_4xx: 0,
    fail_5xx: 0,
    fail_429: 0,
    fail_507: 0,
    bytes_gz: 2048,
    dur_p95_ms: 300,
    pending_points: 0,
    oldest_pending_s: 0,
  },
  ...extra,
});
const crash = (at: number) => ({
  kind: 'crash',
  at,
  level: 'basic',
  src: 'web',
  v: '0.1.0',
  data: { runtime: 'web', class: 'TypeError', frames: ['app.js:10'], fatal: false },
});
const send = (events: unknown[], headers: object) =>
  h.call('POST', '/diagnostics/events', { events }, headers);
const list = (query = '', headers: object = { cookie }) =>
  h.call('GET', `/diagnostics/events${query}`, undefined, headers);

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  ({ auth } = await h.pair(cookie));
  h.clock.t = T0;
  await send(
    [
      upload(1, T0 + 1000),
      upload(2, T0 + 2000, { shift: SHIFT_A }),
      upload(3, T0 + 3000, { shift: SHIFT_A }),
      upload(4, T0 + 4000),
    ],
    auth,
  );
  await send([crash(T0 + 5000)], { cookie });
});
afterEach(() => h.close());

describe('GET /diagnostics/events (16 section 10, 08)', () => {
  test('lists newest first with the API shape; web session only', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    const { items, next_cursor } = res.json();
    expect(next_cursor).toBeNull();
    expect(items.map((e: { at: number }) => e.at)).toEqual([
      T0 + 5000,
      T0 + 4000,
      T0 + 3000,
      T0 + 2000,
      T0 + 1000,
    ]);
    expect(items[1]).toMatchObject({
      src: 'phone_js',
      device_id: 1,
      seq: 4,
      level: 'basic',
      kind: 'upload.window',
      shift: null,
      cap: null,
      v: '0.1.0',
      received_at: T0,
      data: { attempts: 3, ok: 3 },
    });
    expect(items[0]).toMatchObject({ src: 'web', device_id: null, seq: null, kind: 'crash' });
    expect((await list('', {})).statusCode).toBe(401);
    expect((await list('', auth)).statusCode).toBe(403);
  });

  test('filters by kind (repeated), source, device, shift, level and time', async () => {
    const ids = async (q: string) =>
      (await list(q)).json().items.map((e: { at: number }) => e.at - T0);
    expect(await ids('?kind=crash')).toEqual([5000]);
    expect(await ids('?kind=crash&kind=upload.window&limit=2')).toEqual([5000, 4000]);
    expect(await ids('?src=phone_js')).toEqual([4000, 3000, 2000, 1000]);
    expect(await ids('?device_id=1')).toEqual([4000, 3000, 2000, 1000]);
    expect(await ids('?device_id=2')).toEqual([]);
    expect(await ids(`?shift=${SHIFT_A}`)).toEqual([3000, 2000]);
    expect(await ids('?level=verbose')).toEqual([]);
    expect(await ids(`?from_at=${T0 + 2000}&to_at=${T0 + 4000}`)).toEqual([4000, 3000, 2000]);
  });

  test('pages with a cursor and refuses a cursor it did not issue', async () => {
    const first = (await list('?limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (await list(`?limit=2&cursor=${first.next_cursor}`)).json();
    expect(second.items.map((e: { at: number }) => e.at - T0)).toEqual([3000, 2000]);
    const third = (await list(`?limit=2&cursor=${second.next_cursor}`)).json();
    expect(third.items.map((e: { at: number }) => e.at - T0)).toEqual([1000]);
    expect(third.next_cursor).toBeNull();
    expect((await list('?cursor=nonsense')).statusCode).toBe(422);
    expect((await list('?limit=0')).statusCode).toBe(422);
    expect((await list('?src=mars')).statusCode).toBe(422);
    expect((await list('?shift=nope')).statusCode).toBe(422);
  });

  test('events of equal time are still paged without loss or repeats', async () => {
    await send([upload(10, T0 + 6000), upload(11, T0 + 6000), upload(12, T0 + 6000)], auth);
    const seen: number[] = [];
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      const page = (await list(`?limit=2${cursor}`)).json();
      seen.push(...page.items.map((e: { id: number }) => e.id));
      if (!page.next_cursor) break;
      cursor = `&cursor=${page.next_cursor}`;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  test('module off: 404 and no ingest either', async () => {
    await h.close();
    h = harness({ diagnostics: false });
    ({ cookie } = await h.signUp());
    expect((await list()).statusCode).toBe(404);
  });
});
