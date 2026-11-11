import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deviceHealth, serverHealth } from '../src/diagnostics/health';
import type { EventRow } from '../src/diagnostics/store';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
const T0 = 1_800_000_000_000;
const S1 = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
let id = 0;
const ev = (
  kind: string,
  data: Record<string, unknown>,
  shift: string | null = S1,
  at = T0,
): EventRow => ({
  id: ++id,
  src: 'phone_js',
  deviceId: 1,
  seq: id,
  at,
  receivedAt: at,
  level: 'basic',
  kind,
  shift,
  v: '1',
  data,
});
const win = (extra: Record<string, unknown> = {}) =>
  ev('track.window', {
    fixes: 60,
    acc_hist: [50, 5, 3, 2],
    interval_p50_ms: 10000,
    interval_max_ms: 12000,
    still_gated_s: 0,
    battery_pct: 80,
    charging: false,
    temp_dc: 300,
    thermal: 0,
    ...extra,
  });
const up = (extra: Record<string, unknown> = {}) =>
  ev('upload.window', {
    attempts: 10,
    ok: 10,
    fail_net: 0,
    fail_4xx: 0,
    fail_5xx: 0,
    fail_429: 0,
    fail_507: 0,
    bytes_gz: 1,
    dur_p95_ms: 1,
    pending_points: 0,
    oldest_pending_s: 0,
    ...extra,
  });
const state = (r: ReturnType<typeof deviceHealth>) =>
  Object.fromEntries(r.checks.map((c) => [c.id, c.state]));

describe('device health checks (16 section 10.1)', () => {
  test('all good is green and scores 100; no data is na with score 0', () => {
    const r = deviceHealth(
      [
        win(),
        up(),
        ev(
          'perm.state',
          {
            fine: true,
            background: 'all_time',
            activity_recognition: true,
            notifications: true,
            battery_opt_ignored: true,
            standby_bucket: 'active',
            power_save: false,
          },
          null,
        ),
      ],
      [],
    );
    expect(state(r)).toMatchObject({
      H1: 'green',
      H2: 'green',
      H3: 'green',
      H4: 'green',
      H5: 'green',
      H6: 'na',
      H7: 'na',
    });
    expect(r.score).toBe(100);
    expect(r.shiftsConsidered).toBe(1);
    expect(deviceHealth([], [])).toMatchObject({ score: 0, state: 'na', shiftsConsidered: 0 });
  });

  test('thresholds: restarts, fix quality, upload failures, permissions and agreement', () => {
    const bad = deviceHealth(
      [
        win({ acc_hist: [10, 5, 10, 75] }),
        ev('service.event', { event: 'restarted', reason: 'os_kill_inferred', profile: 'normal' }),
        ev('service.event', { event: 'destroyed', reason: 'os_kill_inferred', profile: 'normal' }),
        up({ attempts: 10, ok: 7, fail_net: 3 }),
        ev(
          'perm.state',
          {
            fine: false,
            background: 'denied',
            activity_recognition: true,
            notifications: true,
            battery_opt_ignored: false,
            standby_bucket: 'restricted',
            power_save: false,
          },
          null,
        ),
      ],
      [
        ev('recon.result', {
          status: 'differs',
          reasons: ['engine_disagreement'],
          diff_m: 5,
          digest_equal: true,
          phone_calc_v: 3,
          server_calc_v: 3,
        }),
      ],
    );
    expect(state(bad)).toMatchObject({ H2: 'red', H3: 'red', H4: 'red', H5: 'red', H6: 'red' });
    const amber = deviceHealth(
      [
        win({ acc_hist: [30, 45, 15, 10] }),
        ev('service.event', { event: 'restarted', reason: 'unknown', profile: 'normal' }),
        up({ attempts: 20, ok: 19, fail_net: 1 }),
      ],
      [
        ev('recon.result', {
          status: 'differs',
          reasons: ['late_points'],
          diff_m: 5,
          digest_equal: false,
          phone_calc_v: 3,
          server_calc_v: 3,
        }),
      ],
    );
    expect(state(amber)).toMatchObject({ H2: 'amber', H3: 'amber', H4: 'amber', H6: 'amber' });
    expect(bad.score).toBeLessThan(amber.score);
  });

  test('coverage counts long gaps; only the last 7 shifts count; battery is compared with the median', () => {
    expect(state(deviceHealth([win({ interval_max_ms: 400_000 })], [])).H1).toBe('red');
    expect(
      state(deviceHealth([win({ interval_max_ms: 400_000, still_gated_s: 340 })], [])).H1,
    ).toBe('green');
    const many = Array.from({ length: 9 }, (_, i) =>
      win({ interval_max_ms: i === 0 ? 900_000 : 10_000 }),
    );
    const shifts = many.map((w, i) => ({
      ...w,
      shift: `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e${String(i).padStart(2, '0')}`,
      at: T0 + i * 1000,
    }));
    const r = deviceHealth(shifts, []);
    expect(r.shiftsConsidered).toBe(7);
    expect(state(r).H1).toBe('green'); // the bad window belongs to the oldest shift, outside the 7
    const sum = (i: number, end: number) => ({
      ...ev('shift.summary', {
        duration_s: 3600,
        battery_start: 100,
        battery_end: end,
        charging_seen: false,
        fixes: 1,
        gap_count: 0,
        service_restarts: 0,
        engine_ms: 1,
      }),
      shift: `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e${String(i).padStart(2, '0')}`,
      at: T0 + i * 1000,
    });
    const heavy = deviceHealth(
      [...shifts, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => sum(i, i >= 7 ? 40 : 90))],
      [],
    );
    expect(heavy.checks.find((c) => c.id === 'H7')!.state).not.toBe('na');
  });
});

describe('server checks', () => {
  const sample = (rss: number, p95: number, max = 10) =>
    ev('server.sample', { rss_mb: rss, lag_p95_ms: p95, lag_max_ms: max });
  const win5 = (n: number, s5: number) => ev('api.window', { n, s5xx: s5 });
  const st = (r: ReturnType<typeof serverHealth>) =>
    Object.fromEntries(r.checks.map((c) => [c.id, c.state]));
  test('colours and the overall state', () => {
    expect(st(serverHealth([sample(90, 10)], [win5(1000, 1)], 3600_000, 'ok'))).toEqual({
      S1: 'green',
      S2: 'green',
      S3: 'green',
      S4: 'green',
      S5: 'green',
    });
    expect(st(serverHealth([sample(120, 70)], [win5(100, 1)], 27 * 3600_000, 'warning'))).toEqual({
      S1: 'amber',
      S2: 'amber',
      S3: 'red',
      S4: 'amber',
      S5: 'amber',
    });
    expect(st(serverHealth([sample(200, 10, 2000)], [], null, 'writes_blocked'))).toEqual({
      S1: 'red',
      S2: 'red',
      S3: 'na',
      S4: 'red',
      S5: 'na',
    });
    expect(serverHealth([], [], null, 'ok')).toMatchObject({ state: 'green' });
  });
});

describe('GET /diagnostics/health, server samples and rollups', () => {
  beforeEach(async () => {
    h = harness({}, { diagnosticsSampleMs: 40 });
    ({ cookie } = await h.signUp());
    ({ auth } = await h.pair(cookie));
  });
  afterEach(() => h.close());

  test('the route lists the paired device and the server, web session only', async () => {
    const res = await h.call('GET', '/diagnostics/health', undefined, { cookie });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({
      device_id: 1,
      name: 'Pixel',
      score: 0,
      state: 'na',
      shifts_considered: 0,
    });
    expect(body.devices[0].checks.map((c: { id: string }) => c.id)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
    ]);
    expect(body.server.checks.map((c: { id: string }) => c.id)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
    ]);
    expect((await h.call('GET', '/diagnostics/health', undefined, auth)).statusCode).toBe(403);
    expect((await h.call('GET', '/diagnostics/health')).statusCode).toBe(401);
  });

  test('the server records server.start, server.sample and api.window by itself', async () => {
    await h.call('GET', '/shifts', undefined, { cookie });
    await h.call('GET', '/shifts/nope', undefined, { cookie });
    await new Promise((r) => setTimeout(r, 150));
    const items = async (kind: string) =>
      (
        await h.call('GET', `/diagnostics/events?kind=${kind}&src=server`, undefined, { cookie })
      ).json().items;
    expect((await items('server.start'))[0].data).toMatchObject({
      node_v: process.versions.node,
      unclean_shutdown: false,
    });
    const sample = (await items('server.sample'))[0];
    expect(sample.data.rss_mb).toBeGreaterThan(10);
    const shifts = (await items('api.window')).find(
      (e: { data: { group: string } }) => e.data.group === 'shifts',
    );
    expect(shifts.data.n).toBeGreaterThanOrEqual(2);
    expect(shifts.data.s4xx).toBeGreaterThanOrEqual(1);
    expect(shifts.data.codes.map((c: { code: string }) => c.code)).toContain('validation_failed');
    const health = (await h.call('GET', '/diagnostics/health', undefined, { cookie })).json();
    expect(health.server.checks.find((c: { id: string }) => c.id === 'S1').state).not.toBe('na');
  });
});

describe('daily rollups (16 section 7.1)', () => {
  test('complete days are rolled up before their raw events expire, and repeating changes nothing', async () => {
    const { openDiagnosticsStore } = await import('../src/diagnostics/store');
    const store = openDiagnosticsStore(':memory:');
    const put = (
      kind: string,
      data: object,
      at: number,
      src = 'server',
      deviceId: number | null = null,
    ) =>
      store.insert({
        userId: 1,
        deviceId,
        receivedAt: at,
        event: { kind, at, level: 'basic', src, v: '1', data } as never,
      });
    const day1 = Date.UTC(2026, 9, 1, 12);
    put('engine.run', { ms: 10 }, day1);
    put('engine.run', { ms: 30 }, day1 + 1000);
    put('server.sample', { rss_mb: 90, lag_p95_ms: 5 }, day1);
    put('api.window', { s5xx: 2 }, day1);
    put('service.event', { event: 'restarted' }, day1, 'phone_native', 1);
    put(
      'upload.window',
      { attempts: 10, fail_net: 1, fail_4xx: 0, fail_5xx: 0, fail_429: 0, fail_507: 0 },
      day1,
      'phone_js',
      1,
    );
    const today = Date.UTC(2026, 9, 2, 3);
    put('engine.run', { ms: 99 }, today); // an incomplete day is not rolled up yet
    store.rollUp(today);
    const rows = store.daily();
    const get = (m: string, d = 0) => rows.find((r) => r.metric === m && r.device_id === d)!;
    expect(get('engine_ms')).toMatchObject({ day: '2026-10-01', n: 2, sum: 40, max: 30 });
    expect(get('rss_mb_max').max).toBe(90);
    expect(get('api_5xx').sum).toBe(2);
    expect(get('service_restarts', 1).n).toBe(1);
    expect(get('upload_fail_pct', 1)).toMatchObject({ n: 10, sum: 1 });
    expect(rows.every((r) => r.day === '2026-10-01')).toBe(true);
    store.rollUp(today);
    expect(store.daily()).toEqual(rows);
    store.rollUp(Date.UTC(2029, 0, 1)); // two years on: the old rows go
    expect(store.daily().filter((r) => r.day === '2026-10-01')).toHaveLength(0);
    store.close();
  });
});
