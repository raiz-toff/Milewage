import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { periodRange } from '../src/goal-progress';
import { harness, type Harness } from './support';

// 18 section 8.1: goals, with progress computed at read time. The clock is Friday 2027-01-15.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const goal = async (over: object = {}) =>
  (
    await send('POST', '/goals', {
      label: 'Weekly',
      metric: 'shifts',
      period: 'weekly',
      target: 5,
      ...over,
    })
  ).json();
let n = 0;
/** An ended shift on a local date, `hours` long. */
async function shift(date: string, hours: number, extra: string = '') {
  n += 1;
  const id = (
    await send('POST', '/shifts', {
      client_id: `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e${String(n).padStart(2, '0')}`,
      vehicle_id: 1,
      started_at: h.clock.t,
    })
  ).json().id;
  h.db
    .prepare(
      `UPDATE shifts SET status = 'ended', ended_at = started_at + ?, local_date = ?, total_m = 10000 ${extra} WHERE id = ?`,
    )
    .run(hours * 3_600_000, date, id);
  return id as number;
}

describe('the period of a goal', () => {
  test('weeks follow the start day, months and years are calendar ones', () => {
    expect(periodRange('weekly', '2027-01-15', 1)).toEqual({
      from: '2027-01-11',
      to: '2027-01-17',
    });
    expect(periodRange('weekly', '2027-01-15', 0)).toEqual({
      from: '2027-01-10',
      to: '2027-01-16',
    });
    expect(periodRange('weekly', '2027-01-17', 1)).toEqual({
      from: '2027-01-11',
      to: '2027-01-17',
    }); // a Sunday
    expect(periodRange('weekly', '2027-01-17', 0)).toEqual({
      from: '2027-01-17',
      to: '2027-01-23',
    });
    expect(periodRange('monthly', '2028-02-10', 1)).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(periodRange('yearly', '2027-07-04', 1)).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
    });
    expect(periodRange('daily', '2027-01-15', 1)).toEqual({ from: '2027-01-15', to: '2027-01-15' });
  });
});

describe('CRUD', () => {
  test('nothing is seeded; create, change, switch off, delete; bad values are 422', async () => {
    expect((await send('GET', '/goals')).json()).toEqual([]);
    const g = await goal({ label: ' Weekly shifts ' });
    expect(g).toMatchObject({
      id: 1,
      label: 'Weekly shifts',
      active: true,
      metric: 'shifts',
      target: 5,
    });
    const p = await send('PATCH', '/goals/1', { target: 8, active: false });
    expect(p.json()).toMatchObject({ target: 8, active: false });
    for (const bad of [
      { target: 0 },
      { metric: 'miles' },
      { period: 'hourly' },
      { label: '' },
      { x: 1 },
    ]) {
      expect(
        (
          await send('POST', '/goals', {
            label: 'a',
            metric: 'shifts',
            period: 'daily',
            target: 1,
            ...bad,
          })
        ).statusCode,
        JSON.stringify(bad),
      ).toBe(422);
    }
    expect((await send('PATCH', '/goals/1', {})).statusCode).toBe(422);
    expect((await send('PATCH', '/goals/9', { target: 1 })).statusCode).toBe(404);
    expect((await send('DELETE', '/goals/1')).statusCode).toBe(204);
    expect((await send('DELETE', '/goals/1')).statusCode).toBe(404);
  });

  test('a paired phone may read goals but not change them', async () => {
    await goal();
    const phone = await h.pair(cookie);
    expect((await h.call('GET', '/goals', undefined, phone.auth)).json()).toHaveLength(1);
    const w = await h.call(
      'POST',
      '/goals',
      { label: 'a', metric: 'shifts', period: 'daily', target: 1 },
      phone.auth,
    );
    expect(w.statusCode).toBe(403);
  });
});

describe('progress', () => {
  test('shift counts and hours cover the period only; no shifts is 0, not null', async () => {
    await goal();
    await goal({ label: 'Hours', metric: 'hours', period: 'weekly', target: 600 });
    const empty = (await send('GET', '/goals')).json();
    expect(empty[0].progress).toMatchObject({
      value: 0,
      ratio: 0,
      period_from: '2027-01-11',
      period_to: '2027-01-17',
      estimated: false,
    });
    await shift('2027-01-12', 3);
    await shift('2027-01-14', 2);
    await shift('2027-01-10', 9); // the Sunday before the week
    const [shifts, hours] = (await send('GET', '/goals')).json();
    expect(shifts.progress).toMatchObject({ value: 2, ratio: 0.4 });
    expect(hours.progress).toMatchObject({ value: 300, ratio: 0.5 });
  });

  test('the week start setting moves the boundary', async () => {
    await goal();
    await shift('2027-01-10', 1);
    expect((await send('GET', '/goals')).json()[0].progress.value).toBe(0);
    await send('PATCH', '/settings', { week_start: 0 });
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: 1,
      period_from: '2027-01-10',
    });
  });

  test('earnings: null with a reason when nothing is entered; typed totals and labels count', async () => {
    await goal({ label: 'Pay', metric: 'earnings', target: 50_000 });
    const id = await shift('2027-01-13', 2);
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: null,
      ratio: null,
      note: 'no earnings entered',
    });
    await send('PUT', `/shifts/${id}/earnings/other`, { gross_cents: 20_000, tips_cents: 5000 });
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: 25_000,
      ratio: 0.5,
      note: null,
    });
  });

  test('active distance is an estimate, and unknown for whole-shift shifts', async () => {
    await goal({ label: 'Km', metric: 'active_distance', period: 'monthly', target: 100_000 });
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: 0,
      estimated: true,
    });
    const a = await shift('2027-01-05', 1, ", segmenter = 'whole_shift', active_m = NULL");
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: null,
      estimated: true,
    });
    expect(a).toBeGreaterThan(0);
    await shift('2027-01-06', 1, ", segmenter = 'stops', active_m = 4000");
    expect((await send('GET', '/goals')).json()[0].progress).toMatchObject({
      value: 4000,
      ratio: 0.04,
      estimated: true,
    });
  });
});

describe('module off', () => {
  test('without goals: no routes, flag false', async () => {
    const off = harness({ goals: false });
    try {
      const { cookie: c } = await off.signUp();
      expect((await off.call('GET', '/goals', undefined, { cookie: c })).statusCode).toBe(404);
      expect(
        (await off.call('GET', '/settings', undefined, { cookie: c })).json().modules.goals,
      ).toBe(false);
    } finally {
      await off.close();
    }
  });
});
