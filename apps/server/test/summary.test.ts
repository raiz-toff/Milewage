import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

/** A shift row written directly, so the period arithmetic is tested without driving the engine. */
function seedShift(n: number, over: Record<string, unknown> = {}) {
  const row = {
    client_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    vehicle_id: 1,
    status: 'ended',
    started_at: 1_000 * n,
    ended_at: 1_000 * n + 2 * 3_600_000,
    local_date: '2027-01-10',
    total_m: 10_000,
    active_m: 6_000,
    deadhead_m: 3_000,
    personal_m: 1_000,
    segmenter: 'stops',
    updated_at: 1,
    ...over,
  };
  const cols = Object.keys(row);
  h.db
    .prepare(
      `INSERT INTO shifts (user_id, ${cols.join(',')}) VALUES (1, ${cols.map(() => '?').join(',')})`,
    )
    .run(...Object.values(row));
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
});
afterEach(() => h.close());

describe('GET /summary (08 section 12)', () => {
  test('an empty period is zeros and nulls, never an invented earnings figure', async () => {
    const res = await web('GET', '/summary?from=2027-01-01&to=2027-01-31');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
      shift_count: 0,
      hours: 0,
      earnings_cents: null,
      tips_cents: null,
      active_m: 0,
      deadhead_m: 0,
      personal_m: 0,
      total_m: 0,
      deduction_cents: null,
      hourly_earnings_cents: null,
    });
  });

  test('sums ended and finalized shifts inside the period, both ends inclusive; active shifts and other dates are left out', async () => {
    seedShift(1, { local_date: '2027-01-01' });
    seedShift(2, {
      local_date: '2027-01-31',
      status: 'finalized',
      total_m: 5_000,
      active_m: 5_000,
      deadhead_m: 0,
      personal_m: 0,
    });
    seedShift(3, { local_date: '2027-02-01' });
    seedShift(4, { local_date: '2026-12-31' });
    seedShift(5, {
      local_date: '2027-01-15',
      status: 'active',
      ended_at: null,
      total_m: null,
      active_m: null,
      deadhead_m: null,
      personal_m: null,
    });
    const body = (await web('GET', '/summary?from=2027-01-01&to=2027-01-31')).json();
    expect(body).toMatchObject({
      shift_count: 2,
      hours: 4,
      total_m: 15_000,
      active_m: 11_000,
      deadhead_m: 3_000,
      personal_m: 1_000,
    });
    expect((await web('GET', '/summary?from=2027-01-31&to=2027-01-31')).json().shift_count).toBe(1);
  });

  test('without from and to it is the current month in the owner time zone', async () => {
    seedShift(1, { local_date: '2027-01-02' });
    seedShift(2, { local_date: '2026-12-31' });
    const body = (await web('GET', '/summary')).json();
    expect([body.from, body.to, body.shift_count]).toEqual(['2027-01-01', '2027-01-15', 1]);
  });

  test('earnings are the sum of labelled payouts and tips; the hourly figure divides by shift hours', async () => {
    const t0 = h.clock.t;
    const fixes = ride(t0);
    const endedAt = t0 + 313 * 5000;
    h.clock.t = endedAt + 60_000;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.slice(0, 100).map(toWire) },
      auth,
    );
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.slice(100, 200).map(toWire) },
      auth,
    );
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.slice(200).map(toWire) },
      auth,
    );
    await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
    const stop = processShift({
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes,
      segmenter: 'stops',
    }).stops[0]!;
    const label = (extra: object) =>
      web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stop.stopKey)}`, {
        role: 'dropoff',
        edited_at: h.clock.t,
        ...extra,
      });

    // A label with no money is "not entered", not zero.
    await label({});
    expect((await web('GET', '/summary')).json()).toMatchObject({
      earnings_cents: null,
      tips_cents: null,
      hourly_earnings_cents: null,
    });

    h.clock.t += 1000;
    await label({ payout_cents: 1500, tip_cents: 300 });
    const body = (await web('GET', '/summary')).json();
    const hours = (endedAt - t0) / 3_600_000;
    expect(body).toMatchObject({ shift_count: 1, earnings_cents: 1800, tips_cents: 300 });
    expect(body.hours).toBeCloseTo(hours, 3);
    expect(body.hourly_earnings_cents).toBe(Math.round(1800 / body.hours));
    expect(body.total_m).toBeGreaterThan(0);

    // Turning the stops setting off hides money that came from labels.
    await web('PATCH', '/settings', { stops_enabled: false });
    expect((await web('GET', '/summary')).json()).toMatchObject({
      earnings_cents: null,
      tips_cents: null,
      hourly_earnings_cents: null,
    });
  });

  test('validation and access', async () => {
    for (const q of [
      'from=2027-02-30',
      'from=2027-02-01&to=2027-01-01',
      'from=yesterday',
      'extra=1',
    ]) {
      expect((await web('GET', `/summary?${q}`)).statusCode).toBe(422);
    }
    expect((await h.call('GET', '/summary')).json().code).toBe('auth_required');
    expect((await h.call('GET', '/summary', undefined, auth)).statusCode).toBe(403);
  });
});

describe('odometer (08 section 3, 07 section 2.2)', () => {
  const year = (extra: object = {}) =>
    web('POST', '/odometer', {
      vehicle_id: 1,
      kind: 'year_start',
      reading_m: 41_000_000,
      recorded_at: 1_798_800_000_000,
      ...extra,
    });

  test('a year reading is recorded, listed, filtered and deleted', async () => {
    const created = await year();
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      id: 1,
      vehicle_id: 1,
      shift_id: null,
      kind: 'year_start',
      reading_m: 41_000_000,
      recorded_at: 1_798_800_000_000,
    });
    await year({
      kind: 'year_end',
      reading_m: 52_000_000,
      recorded_at: 1_799_900_000_000,
    });
    await h.call('POST', '/vehicles', { name: 'Van', kind: 'van' }, { cookie });
    await year({ vehicle_id: 2, reading_m: 5 });

    const all = (await web('GET', '/odometer')).json();
    expect(all).toHaveLength(3);
    expect(all[0].recorded_at).toBeGreaterThanOrEqual(all[1].recorded_at); // newest first
    expect((await web('GET', '/odometer?vehicle_id=2')).json()).toHaveLength(1);
    expect((await web('GET', '/odometer?kind=year_end')).json()).toHaveLength(1);
    // Local dates in the owner's zone (America/Chicago): 2026-12-31 is still 2026.
    expect(
      (await web('GET', '/odometer?from=2027-06-01')).json().map((r: { kind: string }) => r.kind),
    ).toEqual([]);
    expect((await web('GET', '/odometer?to=2027-01-01&vehicle_id=1')).json()).toHaveLength(1);

    expect((await web('DELETE', '/odometer/1')).statusCode).toBe(204);
    expect((await web('GET', '/odometer?vehicle_id=1')).json()).toHaveLength(1);
    expect((await web('DELETE', '/odometer/1')).json().code).toBe('not_found');
  });

  test('shift readings show up in the review and are deletable until the shift is finalized', async () => {
    await h.call(
      'POST',
      '/shifts',
      { client_id: SHIFT, vehicle_id: 1, started_at: h.clock.t },
      auth,
    );
    await h.call(
      'PUT',
      `/shifts/${SHIFT}/odometer/shift_start`,
      { reading_m: 123_000, recorded_at: h.clock.t },
      auth,
    );
    const list = (await web('GET', '/odometer')).json();
    expect(list).toEqual([
      expect.objectContaining({ kind: 'shift_start', shift_id: 1, reading_m: 123_000 }),
    ]);
    h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
    expect((await web('DELETE', `/odometer/${list[0].id}`)).json().code).toBe('shift_finalized');
    h.db.prepare("UPDATE shifts SET status = 'ended'").run();
    expect((await web('DELETE', `/odometer/${list[0].id}`)).statusCode).toBe(204);
  });

  test('validation and access', async () => {
    for (const bad of [
      { vehicle_id: 9 },
      { kind: 'shift_start' },
      { reading_m: -1 },
      { recorded_at: h.clock.t + 10 * 60_000 },
      { extra: 1 },
    ]) {
      expect((await year(bad)).statusCode).toBe(422);
    }
    expect((await h.call('GET', '/odometer', undefined, auth)).statusCode).toBe(403);
    expect((await h.call('DELETE', '/odometer/1', undefined, auth)).statusCode).toBe(403);
    expect((await h.call('GET', '/odometer')).json().code).toBe('auth_required');
  });
});
