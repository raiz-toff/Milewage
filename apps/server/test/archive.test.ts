import { afterEach, describe, expect, test } from 'vitest';
import { algorithmVersion, processShift, type Fix } from '@milewage/track-engine';
import { createArchiveRepository } from '../src/db';
import { simplifyKeeping } from '../src/processing/archive';
import { ride, SHIFT, toWire } from './rides';
import { harness, owner, type Harness } from './support';

const DAY = 24 * 60 * 60 * 1000;
let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const count = (sql: string) => h.db.prepare(sql).pluck().get() as number;
const settle = () => new Promise((r) => setTimeout(r, 120));
const points = () => count('SELECT count(*) FROM telemetry_points');

async function setup({ finalize = true } = {}) {
  h = harness({}, { archiveEveryMs: 25 });
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const batch = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points: batch }, auth);
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
  if (finalize) await web('POST', `/shifts/${SHIFT}/finalize`);
}
afterEach(async () => {
  await h?.close();
  h = undefined as never;
});
/** A web session lasts days, not months: sign in again after the clock jumps. */
async function jump(days: number) {
  h.clock.t += days * DAY;
  const res = await h.call('POST', '/auth/login', {
    username: owner.username,
    password: owner.password,
  });
  cookie = String(res.headers['set-cookie']).split(';')[0] as string;
  await settle();
}

describe('simplifyKeeping (07 section 4.2)', () => {
  const pt = (i: number, lat: number, lon = 0) => ({ seq: i, t: i * 1000, latE7: lat, lonE7: lon });

  test('a straight line collapses to its ends; a bend over 5 m survives; stop fixes are kept', () => {
    const line = Array.from({ length: 50 }, (_, i) => pt(i, 100_000_000 + i * 4496));
    expect(simplifyKeeping(line, []).coordinates).toHaveLength(2);
    // 100 m sideways in the middle is far over the tolerance
    const bend = line.map((p, i) => (i === 25 ? { ...p, lonE7: 14_000 } : p));
    const bent = simplifyKeeping(bend, []);
    expect(bent.coordinates.length).toBeGreaterThan(2);
    expect(bent.times).toContain(25);
    // a stop's first and last fix stay although they lie on the line
    const kept = simplifyKeeping(line, [10_000, 30_000]);
    expect(kept.times).toEqual([0, 10, 30, 49]);
    expect(kept.coordinates[1]).toEqual([0, (100_000_000 + 10 * 4496) / 1e7]);
  });

  test('one point and no points', () => {
    expect(simplifyKeeping([], []).coordinates).toEqual([]);
    expect(simplifyKeeping([pt(1, 5)], []).coordinates).toHaveLength(1);
  });
});

describe('route archive and raw-point retention (M6.6)', () => {
  test('a finalized shift older than the window is archived: points go, totals and trips stay', async () => {
    await setup();
    const before = (await web('GET', `/shifts/${SHIFT}`)).json();
    const trips = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    const raw = fixes.length;
    expect(points()).toBe(raw);
    await settle();
    expect(points()).toBe(raw); // 0 days old: not due

    await jump(91);
    expect(points()).toBe(0);
    const a = createArchiveRepository(h.db).archiveOf(1)!;
    expect(a).toMatchObject({ rawPointCount: raw, toleranceM: 5, archivedAt: h.clock.t });
    expect(a.keptPointCount).toBeLessThan(raw);
    expect(a.keptPointCount).toBeGreaterThanOrEqual(4); // ends and the stop's two fixes
    const g = JSON.parse(a.geometry) as {
      type: string;
      coordinates: number[][];
      properties: { times: number[] };
    };
    expect(g.type).toBe('LineString');
    expect(g.properties.times).toHaveLength(g.coordinates.length);
    expect(g.properties.times[0]).toBe(Math.round(fixes[0]!.recordedAt / 1000));
    expect(g.properties.times.at(-1)).toBe(Math.round(fixes.at(-1)!.recordedAt / 1000));
    const stop = processShift({
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes,
      segmenter: 'stops',
      stopLabels: [],
      interruptions: [],
    }).stops[0]!;
    for (const t of [stop.startedAt, stop.endedAt]) {
      expect(g.properties.times).toContain(Math.round(t / 1000));
    }
    expect((await web('GET', `/shifts/${SHIFT}`)).json()).toEqual(before);
    expect((await web('GET', `/shifts/${SHIFT}/trips`)).json()).toEqual(trips);
  });

  test('the route read uses the archive', async () => {
    await setup();
    const rawRoute = (await web('GET', `/shifts/${SHIFT}/route`)).json();
    expect(rawRoute.source).toBe('raw');
    await jump(91);
    const route = (await web('GET', `/shifts/${SHIFT}/route`)).json();
    expect(route.source).toBe('archive');
    expect(route.t.length).toBeLessThan(rawRoute.t.length);
    expect(route.lat_e7).toHaveLength(route.t.length);
    expect(route.speed_dmps.every((s: unknown) => s === null)).toBe(true);
    expect(route.lat_e7[0]).toBe(rawRoute.lat_e7[0]);
    expect(route.lon_e7.at(-1)).toBe(rawRoute.lon_e7.at(-1));
    expect(route.t[0]).toBe(Math.round(rawRoute.t[0] / 1000) * 1000);
  });

  test('an archived shift cannot be recomputed or relabelled; manual trips still count', async () => {
    await setup({ finalize: false });
    await jump(181);
    expect(points()).toBe(0);
    const flags = (await web('GET', `/shifts/${SHIFT}`))
      .json()
      .flags.map((f: { code: string }) => f.code);
    expect(flags).toContain('archived_unfinalized');
    const total = (await web('GET', `/shifts/${SHIFT}`)).json().total_m;
    const re = await web('POST', `/shifts/${SHIFT}/recalculate`);
    expect([re.statusCode, re.json().code]).toEqual([409, 'not_recomputable']);
    const label = await web(
      'PUT',
      `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(`${SHIFT}:1:stop`)}`,
      {
        role: 'dropoff',
        edited_at: h.clock.t,
      },
    );
    expect(label.json().code).toBe('not_recomputable');
    const [trip] = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    expect((await web('PATCH', `/trips/${trip.id}`, { kind: 'personal' })).json().code).toBe(
      'not_recomputable',
    );
    expect(count('SELECT count(*) FROM trip_overrides')).toBe(0);
    const manual = await web('PUT', `/shifts/${SHIFT}/trips/aaaaaaaa-1111-4222-8333-444444444444`, {
      kind: 'active',
      started_at: t0 + 1000,
      ended_at: t0 + 2000,
      distance_m: 500,
      purpose: 'x',
      edited_at: h.clock.t,
    });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().shift.total_m).toBe(total + 500);
  });

  test('not due: an unfinalized shift at 91 days, a finalized one on an older calc_version', async () => {
    await setup({ finalize: false });
    await jump(91);
    expect(points()).toBe(fixes.length);
    await web('POST', `/shifts/${SHIFT}/finalize`);
    h.db.prepare('UPDATE shifts SET calc_version = 1').run();
    await settle();
    expect(points()).toBe(fixes.length);
    h.db.prepare('UPDATE shifts SET calc_version = ?').run(algorithmVersion);
    await settle();
    expect(points()).toBe(0);
  });

  test('raw_retention_days is honoured', async () => {
    await setup();
    await web('PATCH', '/settings', { raw_retention_days: 30 });
    await jump(29);
    expect(points()).toBe(fixes.length);
    await jump(2);
    expect(points()).toBe(0);
  });

  test('a failed read-back leaves the points where they are', async () => {
    await setup();
    const repo = createArchiveRepository(h.db);
    const row = { shiftId: 1, userId: 1, geometry: JSON.stringify({ coordinates: [[0, 0]] }) };
    expect(() =>
      repo.replacePoints({
        ...row,
        rawPointCount: fixes.length,
        keptPointCount: 5, // the geometry has 1 vertex
        toleranceM: 5,
        archivedAt: 1,
      }),
    ).toThrow(/read back/);
    expect(points()).toBe(fixes.length);
    expect(repo.hasArchive(1)).toBe(false);
    expect(() =>
      repo.replacePoints({
        ...row,
        rawPointCount: fixes.length + 1, // wrong count: rolled back after the delete
        keptPointCount: 1,
        toleranceM: 5,
        archivedAt: 1,
      }),
    ).toThrow(/count changed/);
    expect(points()).toBe(fixes.length);
    expect(repo.hasArchive(1)).toBe(false);
  });
});
