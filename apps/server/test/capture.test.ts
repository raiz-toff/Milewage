import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { haversineDm } from '@milewage/track-engine';
import { anonymizer } from '../src/diagnostics/capture';
import { SHIFT } from './rides';
import { harness, type Harness } from './support';

const DAY = 24 * 3600_000;
let h: Harness;
let cookie: string;
let auth: { authorization: string };
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const dev = (method: string, url: string, body?: object) => h.call(method, url, body, auth);
const OTHER = '11111111-2222-4333-8444-555555555555';
const ANN = 'aaaaaaaa-1111-4222-8333-444444444444';

/** A 1 s cadence drive east and north of Toronto: far more points than the logbook keeps. */
const fixes = (n: number, seq0 = 1, t0 = 1_800_000_000_000) =>
  Array.from({ length: n }, (_, i) => ({
    seq: seq0 + i,
    recorded_at: t0 + i * 1000,
    lat_e7: 436_532_000 + i * 900,
    lon_e7: -793_832_000 + i * 700,
    accuracy_m: 4,
    speed_dmps: 120,
  }));

async function setup(extra: Parameters<typeof harness>[1] = {}) {
  h = harness({ capture: true }, extra);
  ({ cookie } = await h.signUp());
  await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  ({ auth } = await h.pair(cookie));
  await dev('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: h.clock.t });
}
afterEach(() => h.close());

describe('capture sessions (16 section 8)', () => {
  beforeEach(() => setup());

  test('create, one active per device, the device learns it from /settings, end, delete', async () => {
    expect((await dev('POST', '/diagnostics/capture-sessions', { device_id: 1 })).statusCode).toBe(
      403,
    );
    const made = await web('POST', '/diagnostics/capture-sessions', {
      device_id: 1,
      hours: 24,
      max_shifts: 2,
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      id: 1,
      device_id: 1,
      profile: 'dense',
      expires_at: h.clock.t + 24 * 3600_000,
      ended_at: null,
      max_shifts: 2,
      shifts_done: 0,
      fix_count: 0,
      state: 'active',
    });
    const dup = await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    expect([dup.statusCode, dup.json().code]).toEqual([409, 'capture_active']);
    expect((await web('POST', '/diagnostics/capture-sessions', { device_id: 9 })).statusCode).toBe(
      422,
    );
    expect(
      (await web('POST', '/diagnostics/capture-sessions', { device_id: 1, hours: 999 })).statusCode,
    ).toBe(422);

    const settings = (await dev('GET', '/settings')).json();
    expect(settings.diagnostics.capture).toEqual({
      id: 1,
      profile: 'dense',
      expires_at: h.clock.t + 24 * 3600_000,
      max_shifts: 2,
      shifts_done: 0,
    });
    expect((await web('GET', '/settings')).json().diagnostics.capture).toBeNull();

    const ended = await web('PATCH', '/diagnostics/capture-sessions/1', { state: 'ended' });
    expect(ended.json()).toMatchObject({ state: 'ended', ended_at: h.clock.t });
    expect((await dev('GET', '/settings')).json().diagnostics.capture).toBeNull();
    expect((await web('POST', '/diagnostics/capture-sessions', { device_id: 1 })).statusCode).toBe(
      201,
    );
    expect(
      (await web('GET', '/diagnostics/capture-sessions')).json().map((s: { id: number }) => s.id),
    ).toEqual([2, 1]);
    expect((await web('DELETE', '/diagnostics/capture-sessions/1')).statusCode).toBe(204);
    expect((await web('DELETE', '/diagnostics/capture-sessions/1')).statusCode).toBe(404);
  });

  test('a session expires by time, and low disk or the size cap refuse a new one', async () => {
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1, hours: 1 });
    h.clock.t += 2 * 3600_000;
    const fresh = {
      cookie: String(
        (
          await h.call('POST', '/auth/login', {
            username: 'sam',
            password: 'correct horse battery',
          })
        ).headers['set-cookie'],
      ).split(';')[0],
    };
    cookie = fresh.cookie as string;
    expect((await web('GET', '/diagnostics/capture-sessions')).json()[0].state).toBe('expired');
    expect(
      (
        await dev('POST', '/diagnostics/capture-sessions/1/fixes', {
          shift: SHIFT,
          fixes: fixes(2),
        })
      ).json().code,
    ).toBe('capture_active');
    h.volume.free = 500 * 1024 ** 2;
    const low = await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    expect([low.statusCode, low.json().code]).toEqual([507, 'insufficient_storage']);
  });

  test('fixes: stored once, idempotent, flag the shift, own session and shift limit enforced', async () => {
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1, max_shifts: 1 });
    const url = '/diagnostics/capture-sessions/1/fixes';
    const first = await dev('POST', url, { shift: SHIFT, fixes: fixes(100) });
    expect(first.json()).toEqual({ accepted: 100, duplicates: 0 });
    expect((await dev('POST', url, { shift: SHIFT, fixes: fixes(100) })).json()).toEqual({
      accepted: 0,
      duplicates: 100,
    });
    expect((await dev('POST', url, { shift: SHIFT, fixes: fixes(20, 90) })).json()).toEqual({
      accepted: 9,
      duplicates: 11,
    });
    const session = (await web('GET', '/diagnostics/capture-sessions')).json()[0];
    expect(session).toMatchObject({ fix_count: 109, shifts_done: 1 });
    expect(session.bytes).toBeGreaterThan(0);
    const flags = (await web('GET', `/shifts/${SHIFT}`))
      .json()
      .flags.map((f: { code: string }) => f.code);
    expect(flags.filter((c: string) => c === 'capture_session')).toHaveLength(1);
    // a second shift would exceed max_shifts = 1
    await dev('POST', `/shifts/${SHIFT}/end`, { ended_at: h.clock.t });
    await dev('POST', '/shifts', { client_id: OTHER, vehicle_id: 1, started_at: h.clock.t });
    const more = await dev('POST', url, { shift: OTHER, fixes: fixes(2, 500) });
    expect([more.statusCode, more.json().code]).toEqual([409, 'capture_active']);
    expect(
      (await dev('POST', url, { shift: '99999999-2222-4333-8444-555555555555', fixes: fixes(2) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await dev('POST', '/diagnostics/capture-sessions/7/fixes', {
          shift: SHIFT,
          fixes: fixes(2),
        })
      ).statusCode,
    ).toBe(404);
    expect((await web('POST', url, { shift: SHIFT, fixes: fixes(2) })).statusCode).toBe(403);
    expect((await dev('POST', url, { shift: SHIFT, fixes: [] })).statusCode).toBe(422);
    expect(
      (await dev('POST', url, { shift: SHIFT, fixes: [{ ...fixes(1)[0], lat_e7: 950_000_000 }] }))
        .statusCode,
    ).toBe(422);
  });

  test('annotations are idempotent and web only', async () => {
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    const url = `/diagnostics/capture-sessions/1/annotations/${ANN}`;
    const body = {
      at: h.clock.t + 5000,
      kind: 'real_stop',
      shift: SHIFT,
      stop_key: `${SHIFT}:${h.clock.t + 1000}:stop`,
      text: 'pizza place',
    };
    expect((await web('PUT', url, body)).json()).toMatchObject({
      client_id: ANN,
      kind: 'real_stop',
      text: 'pizza place',
    });
    await web('PUT', url, { ...body, kind: 'false_stop' });
    expect((await dev('PUT', url, body)).statusCode).toBe(403);
    expect((await web('PUT', url, { ...body, kind: 'bogus' })).statusCode).toBe(422);
    expect((await web('DELETE', url)).statusCode).toBe(204);
    expect((await web('DELETE', url)).statusCode).toBe(404);
    expect(
      (await web('PUT', `/diagnostics/capture-sessions/9/annotations/${ANN}`, body)).statusCode,
    ).toBe(404);
  });

  test('replay: anonymized by default (no place, no clock, no text), exact on request', async () => {
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    const raw = fixes(60);
    await dev('POST', '/diagnostics/capture-sessions/1/fixes', { shift: SHIFT, fixes: raw });
    const stopKey = `${SHIFT}:${raw[10]!.recorded_at}:stop`;
    await web('PUT', `/diagnostics/capture-sessions/1/annotations/${ANN}`, {
      at: raw[12]!.recorded_at,
      kind: 'real_stop',
      shift: SHIFT,
      stop_key: stopKey,
      text: 'CANARY_PLACE',
    });
    const res = await web('GET', '/diagnostics/capture-sessions/1/replay');
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const lines = res.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ t: 'meta', mode: 'anonymized', fixes: 60, shifts: 1 });
    const fx = lines.filter((l) => l.t === 'fix');
    expect(fx).toHaveLength(60);
    expect(fx[0]).toMatchObject({ at: 0, lat_e7: 0, lon_e7: 0, shift: 'S1' });
    expect(fx[1].at).toBe(1000);
    const ann = lines.find((l) => l.t === 'annotation');
    expect(ann).toMatchObject({
      at: 12000,
      kind: 'real_stop',
      shift: 'S1',
      stop_key: 'S1:10000:stop',
    });
    expect(ann.text).toBeUndefined();
    const sh = lines.find((l) => l.t === 'shift');
    expect(sh).toMatchObject({ shift: 'S1', started_at: expect.any(Number) });
    expect(res.body).not.toContain('CANARY_PLACE');
    expect(res.body).not.toContain(SHIFT);
    expect(res.body).not.toContain('4365');
    const exact = (await web('GET', '/diagnostics/capture-sessions/1/replay?mode=exact')).body;
    expect(exact).toContain('436532000');
    expect(exact).toContain('CANARY_PLACE');
    expect(exact).toContain(SHIFT);
    expect((await dev('GET', '/diagnostics/capture-sessions/1/replay')).statusCode).toBe(403);
    expect((await web('GET', '/diagnostics/capture-sessions/1/replay?mode=x')).statusCode).toBe(
      422,
    );
  });

  test('capture data is not in the debug bundle, and sessions end 30 days later by purge', async () => {
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    await dev('POST', '/diagnostics/capture-sessions/1/fixes', { shift: SHIFT, fixes: fixes(30) });
    await web('PATCH', '/diagnostics/capture-sessions/1', { state: 'ended' });
    const bundle = gunzipSync((await web('GET', '/diagnostics/bundle')).rawPayload).toString();
    expect(bundle).not.toContain('436532');
    expect(bundle).not.toContain('capture_fixes');
    expect((await web('GET', '/diagnostics/bundle?include_capture=1')).statusCode).toBe(422);
    expect((await web('GET', '/diagnostics/capture-sessions')).json()).toHaveLength(1);
  });
});

describe('capture purge and module default', () => {
  test('a purge removes sessions 30 days after they ended', async () => {
    await setup({ captureHousekeepingMs: 30 });
    await web('POST', '/diagnostics/capture-sessions', { device_id: 1 });
    await dev('POST', '/diagnostics/capture-sessions/1/fixes', { shift: SHIFT, fixes: fixes(5) });
    await web('PATCH', '/diagnostics/capture-sessions/1', { state: 'ended' });
    h.clock.t += 31 * DAY;
    cookie = String(
      (await h.call('POST', '/auth/login', { username: 'sam', password: 'correct horse battery' }))
        .headers['set-cookie'],
    ).split(';')[0]!;
    await new Promise((r) => setTimeout(r, 120));
    expect((await web('GET', '/diagnostics/capture-sessions')).json()).toEqual([]);
    expect(h.db.prepare('SELECT 1').pluck().get()).toBe(1);
  });

  test('the module is off by default: no routes, flag false in settings', async () => {
    h = harness();
    ({ cookie } = await h.signUp());
    // `harness({})` enables nothing explicitly; the product default for capture is off (resolveModuleConfig)
    const { serverModules } = await import('../src/modules');
    const { resolveModuleConfig } = await import('@milewage/shared');
    expect(resolveModuleConfig(serverModules, {}, {}).capture).toBe(false);
    expect(resolveModuleConfig(serverModules, {}, { MILEWAGE_MODULE_CAPTURE: '1' }).capture).toBe(
      true,
    );
  });

  test('anonymized replay keeps distances within 0.1% over a 20 km drive (16 section 14, U9)', () => {
    const route = Array.from({ length: 400 }, (_, i) => ({
      latE7: 436_532_000 + Math.round(i * 4_000), // about 44 m per step north
      lonE7: -793_832_000 + Math.round(Math.sin(i / 25) * 30_000 + i * 3_000),
    }));
    const place = anonymizer(route[0]!);
    const length = (pts: { latE7: number; lonE7: number }[]) =>
      pts
        .slice(1)
        .reduce((n, p, i) => n + haversineDm(pts[i]!.latE7, pts[i]!.lonE7, p.latE7, p.lonE7), 0);
    const real = length(route);
    const anon = length(route.map(place));
    expect(real / 10).toBeGreaterThan(15_000); // metres: a drive of well over 15 km
    expect(Math.abs(anon - real) / real).toBeLessThan(0.001);
  });
});
