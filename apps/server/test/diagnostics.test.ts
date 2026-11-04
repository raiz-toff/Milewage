import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDiagnosticsStore } from '../src/diagnostics/store';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  ({ auth } = await h.pair(cookie));
});
afterEach(() => h.close());

const upload = (seq?: number, extra: object = {}) => ({
  kind: 'upload.window',
  at: 1_800_000_000_000,
  level: 'basic',
  src: 'phone_js',
  ...(seq === undefined ? {} : { seq }),
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
const webCrash = {
  kind: 'crash',
  at: 1_800_000_000_000,
  level: 'basic',
  src: 'web',
  v: '0.1.0',
  data: { runtime: 'web', class: 'TypeError', frames: ['app.js:10'], fatal: false },
};
const post = (body: unknown, headers: object = auth, gzip = false) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/diagnostics/events',
    headers: {
      'content-type': 'application/json',
      host: 'mw.test',
      origin: 'http://mw.test',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      ...headers,
    },
    payload: gzip ? gzipSync(JSON.stringify(body)) : JSON.stringify(body),
  });
function diagRows(): { src: string; device_id: number | null; seq: number | null }[] {
  // diagnostics.db is a separate file next to milewage.db.
  const file = join(h.db.name, '..', 'diagnostics.db');
  if (!existsSync(file)) return []; // opened on first use
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT src, device_id, seq FROM diag_events ORDER BY id').all() as never;
  } finally {
    db.close();
  }
}

test('a batch is stored once; the replay is counted as duplicates (gzip works)', async () => {
  const events = [upload(1), upload(2)];
  const first = await post({ events }, auth, true);
  expect(first.json()).toEqual({ accepted: 2, duplicates: 0, discarded: 0, rejected: [] });
  expect((await post({ events })).json()).toMatchObject({ accepted: 0, duplicates: 2 });
  expect((await post({ events: [upload(2), upload(3)] })).json()).toMatchObject({
    accepted: 1,
    duplicates: 1,
  });
  expect(diagRows()).toHaveLength(3);
  expect(diagRows()[0]).toMatchObject({ src: 'phone_js', device_id: 1, seq: 1 });
});

test('rejects are listed by index with a reason and never fail the batch', async () => {
  const events = [
    upload(1),
    upload(2, { kind: 'nope.kind' }),
    upload(), // phone source without seq
    upload(4, { src: 'web' }), // a device cannot send web events
    upload(5, { data: { attempts: 'many' } }),
    upload(6, { extra: 1 }),
    upload(7, { level: 'loud' }),
    'junk',
  ];
  const res = await post({ events });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    accepted: 1,
    duplicates: 0,
    discarded: 0,
    rejected: [
      { index: 1, reason: 'unknown_kind' },
      { index: 2, reason: 'seq_required' },
      { index: 3, reason: 'scope' },
      { index: 4, reason: 'schema' },
      { index: 5, reason: 'pattern' },
      { index: 6, reason: 'level' },
      { index: 7, reason: 'schema' },
    ],
  });
  expect(diagRows()).toHaveLength(1);
});

test('a coordinate in a version string is rejected and not stored', async () => {
  const res = await post({ events: [upload(1, { v: '43.6532123' })] });
  expect(res.json()).toMatchObject({ accepted: 0, rejected: [{ index: 0, reason: 'pattern' }] });
  expect(diagRows()).toHaveLength(0);
});

test('auth and limits: no credential 401, 0 or 201 events 422, a session sends only web', async () => {
  expect((await post({ events: [upload(1)] }, {})).statusCode).toBe(401);
  expect((await post({ events: [] })).statusCode).toBe(422);
  const many = Array.from({ length: 201 }, (_, i) => upload(i + 1));
  expect((await post({ events: many })).statusCode).toBe(422);
  const res = await post({ events: [upload(1), webCrash] }, { cookie });
  expect(res.json()).toMatchObject({ accepted: 1, rejected: [{ index: 0, reason: 'scope' }] });
  expect(diagRows()[0]).toMatchObject({ src: 'web', device_id: null, seq: null });
});

test('the level setting: off stores nothing, verbose events need verbose', async () => {
  const verbose = upload(2, { level: 'verbose' });
  const patch = (diagnostics_level: string) =>
    h.call('PATCH', '/settings', { diagnostics_level }, { cookie });
  await patch('off');
  expect((await post({ events: [upload(1)] })).json()).toMatchObject({ accepted: 0, discarded: 1 });
  await patch('basic');
  expect((await post({ events: [upload(1), verbose] })).json()).toMatchObject({
    accepted: 1,
    discarded: 1,
  });
  await patch('verbose');
  expect((await post({ events: [verbose] })).json()).toMatchObject({ accepted: 1, discarded: 0 });
  h.clock.t += 8 * 24 * 60 * 60 * 1000; // verbose reverts to basic after 7 days
  expect((await post({ events: [upload(3, { level: 'verbose' })] })).json()).toMatchObject({
    discarded: 1,
  });
});

test('rate limit: 30 per minute, burst 15, per device', async () => {
  const codes: number[] = [];
  for (let i = 1; i <= 16; i++) codes.push((await post({ events: [upload(i)] })).statusCode);
  expect(codes.slice(0, 15).every((c) => c === 200)).toBe(true);
  expect(codes[15]).toBe(429);
});

test('with the module off the route is 404', async () => {
  const off = harness({ diagnostics: false });
  const { cookie: c } = await off.signUp();
  const res = await off.call('POST', '/diagnostics/events', { events: [upload(1)] }, { cookie: c });
  expect(res.statusCode).toBe(404);
  expect(existsSync(join(off.db.name, '..', 'diagnostics.db'))).toBe(false);
  await off.close();
});

test('a corrupt diagnostics.db is renamed aside and recreated, never fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-diag-'));
  const path = join(dir, 'diagnostics.db');
  writeFileSync(path, 'this is not a database'.repeat(100));
  let moved = '';
  const store = openDiagnosticsStore(
    path,
    () => 42,
    (to) => (moved = to),
  );
  expect(store.count()).toBe(0);
  expect(moved).toBe(`${path}.bad-42`);
  expect(existsSync(moved)).toBe(true);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
