import { afterEach, describe, expect, test } from 'vitest';
import { harness, type Harness } from './support';

// 18 section 10.1: the analytics groups. The clock is Friday 2027-01-15, 02:00 in Chicago.
let h: Harness;
let cookie: string;
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const q = '?from=2027-01-01&to=2027-01-31';
let n = 0;

async function setup(...args: Parameters<typeof harness>) {
  h = harness(...args);
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  // Mon 11th, Tue 12th and Thu 14th: two hours each, 10 km each.
  const ids: number[] = [];
  for (const [date, extra] of [
    ['2027-01-11', ", segmenter = 'stops', active_m = 7500, deadhead_m = 2500"],
    ['2027-01-12', ", segmenter = 'whole_shift'"],
    ['2027-01-14', ", segmenter = 'whole_shift'"],
  ] as const) {
    n += 1;
    const id = (
      await send('POST', '/shifts', {
        client_id: `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e${String(n).padStart(2, '0')}`,
        vehicle_id: 1,
        started_at: h.clock.t,
      })
    ).json().id as number;
    h.db
      .prepare(
        `UPDATE shifts SET status = 'ended', ended_at = started_at + 7200000, local_date = ?, total_m = 10000 ${extra} WHERE id = ?`,
      )
      .run(date, id);
    ids.push(id);
  }
  await send('PUT', `/shifts/${ids[0]}/earnings/doordash`, {
    gross_cents: 10_000,
    orders: 4,
    online_min: 100,
  });
  await send('PUT', `/shifts/${ids[1]}/earnings/ubereats`, { gross_cents: 20_000, orders: 6 });
  await send('POST', '/expenses', {
    spent_on: '2027-01-10',
    category: 'phone',
    amount_cents: 1000,
  }); // 500 deductible
}
const get = async (group: string, extra = '') =>
  (await send('GET', `/analytics${q}&group=${group}${extra}`)).json();

describe('groups', () => {
  test('cards: gross, expenses and burn, set-aside, net take-home, hourly figures, total time', async () => {
    await setup();
    const c = (await get('cards')).data;
    expect(c).toEqual({
      gross_cents: 30_000,
      expenses_cents: 500,
      burn_ratio: 0.017,
      net_take_home_cents: 22_000, // 30 000 - 500 - 25 % set-aside
      tax_set_aside_cents: 7500,
      hourly_shift_cents: 5000,
      hourly_online_cents: 6000, // 10 000 over 100 online minutes
      total_hours: 6,
    });
  });

  test('trends: buckets with null where nothing was entered, and the previous period', async () => {
    await setup();
    const t = (await get('trends')).data;
    expect(t.buckets).toEqual([
      {
        start: '2027-01-11',
        shifts: 1,
        hours: 2,
        distance_m: 10000,
        earnings_cents: 10_000,
        hourly_cents: 5000,
      },
      {
        start: '2027-01-12',
        shifts: 1,
        hours: 2,
        distance_m: 10000,
        earnings_cents: 20_000,
        hourly_cents: 10_000,
      },
      {
        start: '2027-01-14',
        shifts: 1,
        hours: 2,
        distance_m: 10000,
        earnings_cents: null,
        hourly_cents: null,
      },
    ]);
    expect(t.previous).toEqual({ earnings_cents: null, hours: 0, distance_m: 0 });
    const weeks = (await get('trends', '&bucket=week')).data.buckets;
    expect(weeks).toEqual([
      expect.objectContaining({ start: '2027-01-11', shifts: 3, earnings_cents: 30_000 }),
    ]);
    const months = (await get('trends', '&bucket=month')).data.buckets;
    expect(months[0].start).toBe('2027-01');
  });

  test('rhythm, sources, outlook, efficiency, order economics', async () => {
    await setup();
    const r = (await get('rhythm')).data;
    expect(
      r.by_weekday
        .filter((d: { shifts: number }) => d.shifts)
        .map((d: { weekday: number }) => d.weekday),
    ).toEqual([1, 2, 4]);
    expect(r.by_start_hour[2]).toEqual({ hour: 2, shifts: 3 });
    expect(r.average_shift_minutes).toBe(120);

    expect((await get('sources')).data).toEqual([
      { platform: 'ubereats', earnings_cents: 20_000, tips_cents: 0, share: 0.667 },
      { platform: 'doordash', earnings_cents: 10_000, tips_cents: 0, share: 0.333 },
    ]);
    expect((await get('outlook')).data).toEqual({
      projected_earnings_cents: 62_000,
      days_left: 16,
      note: 'straight-line projection',
    });
    expect((await get('efficiency')).data).toEqual({
      estimated: true,
      active_share: 0.75,
      deadhead_share: 0.25,
      hourly_spread: 0.333,
    });
    expect((await get('order_economics')).data).toMatchObject({
      orders: 10,
      pay_per_order_cents: 3000,
      orders_per_hour: 1.67,
      pay_per_km_cents: 1000,
    });
  });

  test('honesty: no earnings gives nulls; fewer than 3 shifts gives no projection; the platform filter is earnings-only', async () => {
    await setup();
    const none = (await send('GET', '/analytics?from=2026-06-01&to=2026-06-30&group=cards')).json()
      .data;
    expect(none).toMatchObject({ gross_cents: null, hourly_shift_cents: null, total_hours: 0 });
    expect(
      (await send('GET', '/analytics?from=2026-06-01&to=2026-06-30&group=outlook')).json().data
        .projected_earnings_cents,
    ).toBeNull();
    expect(
      (await send('GET', '/analytics?from=2026-06-01&to=2026-06-30&group=order_economics')).json()
        .data,
    ).toBeNull();
    const filtered = await send('GET', `/analytics${q}&group=cards&platform=doordash`);
    expect(filtered.json()).toMatchObject({
      platform_filter: 'earnings_only',
      data: { gross_cents: 10_000, total_hours: 6 },
    });
  });

  test('validation', async () => {
    await setup();
    for (const bad of [
      '?from=2027-02-30',
      '?from=2027-02-01&to=2027-01-01',
      '?group=weather',
      '?from=2020-01-01&to=2027-01-01',
    ]) {
      expect((await send('GET', `/analytics${bad}`)).statusCode, bad).toBe(422);
    }
    expect((await h.call('GET', '/analytics')).statusCode).toBe(401);
  });
});

describe('modules decide what a card says', () => {
  test('without expenses and tax the cards leave those lines out instead of showing 0', async () => {
    await setup({ tax: false, expenses: false, receipts: false });
    const c = (await get('cards')).data;
    expect(c).toEqual({
      gross_cents: 30_000,
      hourly_shift_cents: 5000,
      hourly_online_cents: 6000,
      total_hours: 6,
    });
  });

  test('without earnings the money lines are null and the hours stay', async () => {
    await setup({ earnings: false, stops: false, tracking: false, replay: false });
    // the typed totals were refused (404), so only labels could count and none exist
    const c = (await get('cards')).data;
    expect(c).toMatchObject({ gross_cents: null, total_hours: 6 });
  });

  test('analytics off: the route is a 404 and the flag false', async () => {
    h = harness({ analytics: false });
    ({ cookie } = await h.signUp());
    expect((await send('GET', '/analytics')).statusCode).toBe(404);
    expect((await send('GET', '/settings')).json().modules.analytics).toBe(false);
  });
});
