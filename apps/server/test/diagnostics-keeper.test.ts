import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import type { DiagEvent } from '@milewage/shared';
import { createDiagnosticsKeeper } from '../src/diagnostics/keeper';
import { openDiagnosticsStore, type DiagnosticsStore } from '../src/diagnostics/store';
import { harness, type Harness } from './support';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const event = (kind: string, level: 'basic' | 'verbose', over: Partial<DiagEvent> = {}) =>
  ({
    src: 'phone_js',
    at: T0,
    level,
    kind,
    v: '0.1.0',
    data: { pad: 'x'.repeat(200) },
    ...over,
  }) as DiagEvent;
const dirs: string[] = [];
/** A store on a file, so a second read-only connection can look at what it holds. */
function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-diag-'));
  dirs.push(dir);
  const file = join(dir, 'diagnostics.db');
  return { store: openDiagnosticsStore(file), file };
}
function query<T>(file: string, sql: string): T[] {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const put = (store: DiagnosticsStore, e: DiagEvent, receivedAt = T0) =>
  store.insert({ userId: 1, deviceId: 1, receivedAt, event: e });

describe('retention (16 section 7.2)', () => {
  test('basic 90 days, verbose 14 days, crashes 365 days', () => {
    const { store } = openStore();
    put(store, event('upload.window', 'basic', { seq: 1 }));
    put(store, event('upload.window', 'verbose', { seq: 2 }));
    put(store, event('crash', 'basic', { seq: 3 }));
    expect(store.pruneExpired(T0 + 13 * DAY)).toBe(0);
    expect(store.pruneExpired(T0 + 15 * DAY)).toBe(1); // verbose
    expect(store.pruneExpired(T0 + 89 * DAY)).toBe(0);
    expect(store.pruneExpired(T0 + 91 * DAY)).toBe(1); // basic
    expect(store.count()).toBe(1);
    expect(store.pruneExpired(T0 + 364 * DAY)).toBe(0);
    expect(store.pruneExpired(T0 + 366 * DAY)).toBe(1); // crash
    expect(store.count()).toBe(0);
    store.close();
  });

  test('deletes in batches, so the writer is never held for long', () => {
    const { store } = openStore();
    for (let i = 1; i <= 23; i++) put(store, event('upload.window', 'basic', { seq: i }));
    expect(store.pruneExpired(T0 + 91 * DAY, 5)).toBe(23);
    expect(store.count()).toBe(0);
    store.close();
  });

  test('the size cap drops verbose rows first, then the oldest basic rows, and never a crash', () => {
    const { store, file } = openStore();
    let seq = 0;
    for (let i = 0; i < 1500; i++) {
      put(store, event('upload.window', 'verbose', { seq: ++seq }), T0 + i);
      put(store, event('upload.window', 'basic', { seq: ++seq, at: T0 + i }), T0 + i);
    }
    put(store, event('crash', 'basic', { seq: ++seq }));
    const rows = (where: string) =>
      query<{ n: number }>(file, `SELECT count(*) AS n FROM diag_events WHERE ${where}`)[0]!.n;
    const full = store.liveBytes();
    expect(store.enforceCap(full * 2)).toBe(0); // under the cap: nothing happens
    // A cap that dropping the verbose half satisfies: only verbose goes.
    expect(store.enforceCap(Math.floor(full * 0.75))).toBeGreaterThan(0);
    expect(rows("level = 'verbose'")).toBeLessThan(1500); // only as many as the cap needs
    expect(rows("level = 'basic' AND kind = 'upload.window'")).toBe(1500);
    // A cap below what basic needs: the oldest basic rows go, the crash stays.
    store.enforceCap(Math.floor(full * 0.2));
    expect(rows("kind = 'crash'")).toBe(1);
    const left = rows("kind = 'upload.window'");
    expect(left).toBeLessThan(1500);
    expect(left).toBeGreaterThan(0);
    expect(rows(`kind = 'upload.window' AND at < ${T0 + 100}`)).toBe(0); // the oldest are the ones that went
    expect(store.liveBytes()).toBeLessThanOrEqual(Math.floor(full * 0.2) + 64 * 1024);
    store.close();
  });
});
describe('the keeper and diag.self', () => {
  const setup = (
    over: { disk?: () => 'ok' | 'writes_blocked'; owner?: () => number | undefined } = {},
  ) => {
    const { store, file } = openStore();
    let t = T0;
    const keeper = createDiagnosticsKeeper({
      store: () => store,
      now: () => t,
      owner: over.owner ?? (() => 1),
      version: '0.1.0',
      disk: over.disk as never,
    });
    return { store, keeper, file, advance: (ms: number) => (t += ms) };
  };

  test('a pass prunes and writes one server diag.self with the drop counts, then starts counting again', () => {
    const { store, keeper, advance, file } = setup();
    put(store, event('upload.window', 'basic', { seq: 1 }));
    keeper.drop('level_off', 3);
    keeper.drop('disk_low');
    keeper.drop('schema_reject', 2);
    advance(91 * DAY);
    const r = keeper.run();
    expect(r).toMatchObject({ paused: false, expired: 1, capped: 0, reported: true });
    expect(keeper.counts()).toEqual({ ring_full: 0, schema_reject: 0, level_off: 0, disk_low: 0 });
    const self = selfRows(file);
    expect(self).toHaveLength(1);
    expect(self[0]).toMatchObject({
      src: 'server',
      device_id: null,
      kind: 'diag.self',
      level: 'basic',
    });
    expect(JSON.parse(self[0]!.data)).toMatchObject({
      dropped: { ring_full: 0, schema_reject: 2, level_off: 3, disk_low: 1 },
      pending: 0,
      ring_kb: 0,
    });
    store.close();
  });

  test('paused while writes are blocked; the counts are kept and reported on recovery', () => {
    let state: 'ok' | 'writes_blocked' = 'writes_blocked';
    const { store, keeper, advance, file } = setup({ disk: () => state });
    keeper.drop('disk_low', 4);
    advance(DAY);
    expect(keeper.run()).toEqual({ paused: true });
    expect(store.count()).toBe(0);
    state = 'ok';
    advance(DAY);
    expect(keeper.run()).toMatchObject({ paused: false, reported: true });
    expect(JSON.parse(selfRows(file)[0]!.data).dropped.disk_low).toBe(4);
    store.close();
  });

  test('the report is a valid catalogue event, and nothing is written before an owner exists', async () => {
    const { validateEvent } = await import('@milewage/shared');
    const { store, keeper, file } = setup();
    keeper.run();
    const row = selfRows(file)[0]!;
    const e = {
      src: row.src,
      at: row.at,
      level: row.level,
      kind: row.kind,
      v: row.app_v,
      data: JSON.parse(row.data),
    };
    expect(validateEvent(e)).toMatchObject({ ok: true });
    const none = setup({ owner: () => undefined });
    expect(none.keeper.run()).toMatchObject({ reported: false });
    expect(none.store.count()).toBe(0);
    store.close();
    none.store.close();
  });
});

const selfRows = (file: string) =>
  query<{
    src: string;
    device_id: number | null;
    kind: string;
    level: string;
    at: number;
    app_v: string;
    data: string;
  }>(file, "SELECT * FROM diag_events WHERE kind = 'diag.self'");

describe('inside the server', () => {
  let h: Harness;
  afterEach(() => h.close());

  test('the retention job runs on its interval and the server reports its own drops', async () => {
    h = harness({}, { diagnosticsHousekeepingMs: 30 });
    const { cookie } = await h.signUp();
    const { auth } = await h.pair(cookie);
    await h.call('PATCH', '/settings', { diagnostics_level: 'off' }, { cookie });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/diagnostics/events',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: JSON.stringify({
        events: [event('upload.window', 'basic', { seq: 1, data: uploadData })],
      }),
    });
    expect(res.json()).toMatchObject({ discarded: 1 });
    const file = join(h.db.name, '..', 'diagnostics.db');
    const read = () => {
      if (!existsSync(file)) return [];
      const db = new Database(file, { readonly: true });
      try {
        return db
          .prepare("SELECT data FROM diag_events WHERE kind = 'diag.self'")
          .pluck()
          .all() as string[];
      } finally {
        db.close();
      }
    };
    const deadline = Date.now() + 3000;
    const total = () => read().reduce((n, d) => n + (JSON.parse(d).dropped.level_off as number), 0);
    while (total() < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const reports = read().map((d) => JSON.parse(d).dropped.level_off as number);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.reduce((a, b) => a + b, 0)).toBe(1); // counted once, then reset
  });
});

const uploadData = {
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
};
