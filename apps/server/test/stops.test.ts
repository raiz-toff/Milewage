import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift, type Fix, type StopLabelInput } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

const engine = (stopLabels: StopLabelInput[] = [], segmenter: 'stops' | 'whole_shift' = 'stops') =>
  processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes,
    segmenter,
    stopLabels,
    interruptions: [],
  });
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const key = (k: string) => encodeURIComponent(k);
const label = (extra: object = {}) => ({ role: 'dropoff', edited_at: h.clock.t, ...extra });

async function setup(modules: Record<string, boolean> = {}) {
  h = harness(modules);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
}
afterEach(() => h.close());

describe('stops and labels (07 section 2.8, 14 section 6.6)', () => {
  beforeEach(() => setup());

  test('GET /shifts/{ref}/stops lists the derived stops, web session only', async () => {
    const want = engine().stops;
    expect(want).toHaveLength(1);
    const res = await web('GET', `/shifts/${SHIFT}/stops`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        stop_key: want[0]!.stopKey,
        shift_id: 1,
        started_at: want[0]!.startedAt,
        ended_at: want[0]!.endedAt,
        dwell_s: want[0]!.dwellS,
        lat_e7: want[0]!.latE7,
        lon_e7: want[0]!.lonE7,
        confidence: want[0]!.confidence,
        est_role: 'pickup',
        role: 'pickup',
        label: null,
      },
    ]);
    expect((await h.call('GET', '/shifts/1/stops')).json().code).toBe('auth_required');
    expect((await h.call('GET', '/shifts/1/stops', undefined, auth)).statusCode).toBe(403);
  });

  test('a label recomputes the shift: the split moves, the business total never does', async () => {
    const stopKey = engine().stops[0]!.stopKey;
    const before = (await web('GET', `/shifts/${SHIFT}`)).json();
    const res = await web(
      'PUT',
      `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`,
      label({ platform: 'ubereats', payout_cents: 850, tip_cents: 200, place: 'Pizza Place' }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-milewage-applied']).toBe('true');
    const want = engine([{ stopKey, role: 'dropoff' }]);
    expect(want.totals.activeM).not.toBe(before.active_m);
    expect(res.json().shift).toMatchObject({
      total_m: before.total_m,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
    });
    expect(res.json().stop).toMatchObject({
      stop_key: stopKey,
      est_role: 'pickup',
      role: 'dropoff',
      label: {
        role: 'dropoff',
        platform: 'ubereats',
        payout_cents: 850,
        tip_cents: 200,
        place: 'Pizza Place',
        stop_key: stopKey,
      },
    });
    expect(h.db.prepare('SELECT count(*) FROM trips').pluck().get()).toBe(want.trips.length);
    // the same call again is idempotent: not newer, nothing changes
    const again = await web(
      'PUT',
      `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`,
      label({ role: 'pickup', edited_at: h.clock.t }),
    );
    expect(again.headers['x-milewage-applied']).toBe('false');
    expect(again.json().stop.role).toBe('dropoff');
  });

  test('a newer edit replaces the label; DELETE returns the engine estimate', async () => {
    const stopKey = engine().stops[0]!.stopKey;
    const url = `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`;
    const original = (await web('GET', `/shifts/${SHIFT}`)).json();
    await web('PUT', url, label());
    const newer = await web('PUT', url, label({ role: 'other', edited_at: h.clock.t + 1000 }));
    expect(newer.headers['x-milewage-applied']).toBe('true');
    expect(newer.json().stop.label.role).toBe('other');
    const cleared = await web('DELETE', url);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().stop).toMatchObject({ role: 'pickup', label: null });
    expect(cleared.json().shift).toMatchObject({
      active_m: original.active_m,
      deadhead_m: original.deadhead_m,
    });
    expect(h.db.prepare('SELECT count(*) FROM stop_labels').pluck().get()).toBe(0);
  });

  test('an orphaned label (its stop is gone) can be cleared; the answer has no stop', async () => {
    const orphan = `${SHIFT}:1:stop`;
    h.db
      .prepare(
        "INSERT INTO stop_labels (user_id, shift_id, stop_key, role, edited_at) VALUES (1, 1, ?, 'pickup', 1)",
      )
      .run(orphan);
    const cleared = await web('DELETE', `/shifts/${SHIFT}/stop-labels/${key(orphan)}`);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().stop).toBeNull();
    expect(h.db.prepare('SELECT count(*) FROM stop_labels').pluck().get()).toBe(0);
  });

  test('a label whose stop disappears after a recompute raises label_orphaned and stays stored', async () => {
    const stopKey = engine().stops[0]!.stopKey;
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`, label());
    h.db.prepare('UPDATE stop_labels SET stop_key = ?').run(`${SHIFT}:1:stop`);
    // any recompute: relabel the real stop again
    const res = await web(
      'PUT',
      `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`,
      label({ role: 'pickup' }),
    );
    expect(res.json().shift.flags.map((f: { code: string }) => f.code)).toContain('label_orphaned');
    expect(h.db.prepare('SELECT count(*) FROM stop_labels').pluck().get()).toBe(2);
  });

  test('refusals: unknown stop, active shift, finalized shift, invalid body', async () => {
    const stopKey = engine().stops[0]!.stopKey;
    const url = `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`;
    expect(
      (await web('PUT', `/shifts/${SHIFT}/stop-labels/${key('nope:1:stop')}`, label())).statusCode,
    ).toBe(404);
    expect(
      (await web('DELETE', `/shifts/${SHIFT}/stop-labels/${key('nope:1:stop')}`)).statusCode,
    ).toBe(404);
    for (const bad of [
      { platform: 'Uber Eats' },
      { colour: 'red' },
      { payout_cents: -1 },
      { role: 'x' },
    ]) {
      expect((await web('PUT', url, label(bad))).statusCode).toBe(422);
    }
    expect((await web('PUT', url, { role: 'dropoff' })).statusCode).toBe(422);
    expect((await web('PUT', url, label({ edited_at: h.clock.t + 10 * 60_000 }))).statusCode).toBe(
      422,
    );
    expect((await h.call('PUT', url, label(), auth)).statusCode).toBe(403);
    h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
    expect((await web('PUT', url, label())).json().code).toBe('shift_finalized');
    h.db.prepare("UPDATE shifts SET status = 'active'").run();
    expect((await web('PUT', url, label())).json().code).toBe('shift_not_ended');
  });

  test('stops_enabled off: routes are 404, stored rows are kept, the past shift is unchanged, new shifts are whole_shift', async () => {
    const stopKey = engine().stops[0]!.stopKey;
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`, label());
    const shiftBefore = (await web('GET', `/shifts/${SHIFT}`)).json();
    await web('PATCH', '/settings', { stops_enabled: false });
    for (const [m, u] of [
      ['GET', `/shifts/${SHIFT}/stops`],
      ['PUT', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`],
      ['DELETE', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`],
    ] as const) {
      const res = await web(m, u, m === 'PUT' ? label() : undefined);
      expect([res.statusCode, res.json().code]).toEqual([404, 'not_found']);
    }
    expect(h.db.prepare('SELECT count(*) FROM stops').pluck().get()).toBe(1);
    expect(h.db.prepare('SELECT count(*) FROM stop_labels').pluck().get()).toBe(1);
    expect((await web('GET', `/shifts/${SHIFT}`)).json()).toEqual(shiftBefore);
    const fresh = '22222222-2222-4222-8222-222222222222';
    await h.call(
      'POST',
      '/shifts',
      { client_id: fresh, vehicle_id: 1, started_at: endedAt + 100_000 },
      auth,
    );
    expect(
      h.db.prepare('SELECT segmenter FROM shifts WHERE client_id = ?').pluck().get(fresh),
    ).toBe('whole_shift');
    await web('PATCH', '/settings', { stops_enabled: true });
    expect((await web('GET', `/shifts/${SHIFT}/stops`)).json()).toHaveLength(1);
  });
});

describe('trips and route reads', () => {
  beforeEach(() => setup());

  test('GET /shifts/{ref}/trips lists the derived trips in time order, for a web session and for the phone', async () => {
    const want = engine().trips;
    for (const headers of [{ cookie }, auth]) {
      const res = await h.call('GET', `/shifts/${SHIFT}/trips`, undefined, headers);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(want.length);
      expect(res.json().map((t: { trip_key: string }) => t.trip_key)).toEqual(
        want.map((t) => t.tripKey),
      );
      expect(res.json()[0]).toMatchObject({
        shift_id: 1,
        source: 'auto',
        edited_at: null,
        distance_m: want[0]!.distanceM,
      });
      expect('user_id' in res.json()[0]).toBe(false);
    }
    expect((await web('GET', '/shifts/999/trips')).json().code).toBe('shift_not_found');
  });

  test('GET /shifts/{ref}/route returns parallel arrays of the stored points', async () => {
    const res = await web('GET', `/shifts/${SHIFT}/route`);
    const body = res.json();
    expect(body.source).toBe('raw');
    expect(body.t).toEqual(fixes.map((f) => f.recordedAt));
    expect(body.lat_e7).toEqual(fixes.map((f) => f.latE7));
    expect(body.lon_e7).toHaveLength(fixes.length);
    expect(body.speed_dmps).toEqual(fixes.map(() => null));
    expect((await h.call('GET', `/shifts/${SHIFT}/route`, undefined, auth)).statusCode).toBe(200);
  });

  test('a phone cannot read a shift older than its 14 day window; the web can', async () => {
    h.clock.t += 15 * 24 * 3600_000;
    h.db.prepare('UPDATE shifts SET device_touched_at = NULL').run();
    expect((await h.call('GET', `/shifts/${SHIFT}/route`, undefined, auth)).statusCode).toBe(404);
    expect((await h.call('GET', `/shifts/${SHIFT}/trips`, undefined, auth)).statusCode).toBe(404);
    expect((await web('GET', `/shifts/${SHIFT}/route`)).statusCode).toBe(200);
  });
});

describe('module switches', () => {
  test('a replay flag left from before is ignored: the route is served with tracking', async () => {
    await setup({ replay: false });
    expect((await web('GET', `/shifts/${SHIFT}/route`)).statusCode).toBe(200);
    expect((await web('GET', `/shifts/${SHIFT}/trips`)).statusCode).toBe(200);
  });
  test('stops module off: no stops are derived or served', async () => {
    await setup({ stops: false });
    expect((await web('GET', `/shifts/${SHIFT}/stops`)).json().code).toBe('not_found');
    expect(h.db.prepare('SELECT count(*) FROM stops').pluck().get()).toBe(0);
  });
});
