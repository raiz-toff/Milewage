import { afterEach, describe, expect, test } from 'vitest';
import { bucketStarts, summarySeries } from '../src/analytics-series';
import type { SeriesShift } from '../src/analytics-series';
import type { EffectiveRow } from '../src/db';
import { harness, type Harness } from './support';

const shift = (over: Partial<SeriesShift> = {}): SeriesShift => ({
  id: 1,
  vehicleId: 1,
  localDate: '2027-01-11',
  startedAt: Date.parse('2027-01-11T15:00:00Z'),
  endedAt: Date.parse('2027-01-11T17:00:00Z'),
  totalM: 10_000,
  activeM: 6_000,
  deadheadM: 3_000,
  personalM: 1_000,
  segmenter: 'stops',
  ...over,
});
const earning = (over: Partial<EffectiveRow> = {}): EffectiveRow => ({
  shiftId: 1,
  localDate: '2027-01-11',
  platform: 'doordash',
  grossCents: 5_000,
  tipsCents: 1_000,
  bonusCents: 0,
  feesCents: -500,
  adjustmentsCents: 0,
  taxWithheldCents: 0,
  orders: 4,
  onlineMin: null,
  source: 'entered',
  ...over,
});

describe('bucketStarts', () => {
  test('every day, or the first of every month, both ends included', () => {
    expect(bucketStarts('2027-01-30', '2027-02-02', 'day')).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-01',
      '2027-02-02',
    ]);
    expect(bucketStarts('2026-11-15', '2027-02-03', 'month')).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ]);
  });
});

describe('summarySeries', () => {
  test('fills every slot; null earnings only where shifts have nothing entered', () => {
    const s = summarySeries({
      from: '2027-01-10',
      to: '2027-01-13',
      bucket: 'day',
      shifts: [
        shift(),
        shift({
          id: 2,
          localDate: '2027-01-12',
          segmenter: 'whole_shift',
          activeM: 9_000,
          deadheadM: 0,
        }),
      ],
      earnings: [
        earning(),
        earning({ platform: 'ubereats', grossCents: 2_000, tipsCents: 0, feesCents: 0 }),
      ],
      earningsKnown: true,
    });
    expect(s.buckets.map((b) => [b.start, b.shift_count, b.earnings_cents])).toEqual([
      ['2027-01-10', 0, 0],
      ['2027-01-11', 1, 7_500],
      ['2027-01-12', 1, null],
      ['2027-01-13', 0, 0],
    ]);
    expect(s.buckets[1]).toMatchObject({
      hours: 2,
      tips_cents: 1_000,
      active_m: 6_000,
      deadhead_m: 3_000,
      personal_m: 1_000,
      total_m: 10_000,
      unsplit_m: 0,
      platforms: [
        { platform: 'doordash', earnings_cents: 5_500, tips_cents: 1_000 },
        { platform: 'ubereats', earnings_cents: 2_000, tips_cents: 0 },
      ],
    });
    expect(s.buckets[2]).toMatchObject({ unsplit_m: 9_000, active_m: 9_000, tips_cents: null });
  });

  test('by month; with no way to know earnings every bucket is null', () => {
    const s = summarySeries({
      from: '2026-12-01',
      to: '2027-01-31',
      bucket: 'month',
      shifts: [shift(), shift({ id: 2, localDate: '2027-01-20' })],
      earnings: [],
      earningsKnown: false,
    });
    expect(s.buckets.map((b) => [b.start, b.shift_count, b.hours, b.earnings_cents])).toEqual([
      ['2026-12-01', 0, 0, null],
      ['2027-01-01', 2, 4, null],
    ]);
  });
});

// The routes, on a server; the clock is Friday 2027-01-15, 02:00 in Chicago.
let h: Harness;
let cookie: string;
afterEach(() => h?.close());
const send = (method: string, url: string) => h.call(method, url, undefined, { cookie });

async function setup(...args: Parameters<typeof harness>) {
  h = harness(...args);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  const id = (
    await h.call(
      'POST',
      '/shifts',
      {
        client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e01',
        vehicle_id: 1,
        started_at: h.clock.t,
      },
      { cookie },
    )
  ).json().id as number;
  h.db
    .prepare(
      `UPDATE shifts SET status = 'ended', ended_at = started_at + 7200000, local_date = '2027-01-15',
         total_m = 10000, active_m = 7500, deadhead_m = 2500, personal_m = 0, segmenter = 'stops' WHERE id = ?`,
    )
    .run(id);
  await h.call(
    'PUT',
    `/shifts/${id}/earnings/doordash`,
    { gross_cents: 10_000, tips_cents: 2_000 },
    { cookie },
  );
}

describe('GET /summary/series', () => {
  test('a day per slot with the shift’s figures, and validation', async () => {
    await setup();
    const res = await send('GET', '/summary/series?from=2027-01-14&to=2027-01-16');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ from: '2027-01-14', to: '2027-01-16', bucket: 'day' });
    expect(body.buckets.map((b: { earnings_cents: number | null }) => b.earnings_cents)).toEqual([
      0, 12_000, 0,
    ]);
    expect(body.buckets[1]).toMatchObject({
      shift_count: 1,
      hours: 2,
      tips_cents: 2_000,
      active_m: 7500,
      deadhead_m: 2500,
      unsplit_m: 0,
      platforms: [{ platform: 'doordash', earnings_cents: 12_000, tips_cents: 2_000 }],
    });
    const month = (
      await send('GET', '/summary/series?from=2026-02-01&to=2027-01-31&bucket=month')
    ).json();
    expect(month.buckets).toHaveLength(12);
    expect(month.buckets.at(-1)).toMatchObject({ start: '2027-01-01', earnings_cents: 12_000 });
    for (const bad of [
      '?from=2027-01-01',
      '?from=2027-02-30&to=2027-03-01',
      '?from=2027-02-01&to=2027-01-01',
      '?from=2026-01-01&to=2027-01-31',
      '?from=2024-01-01&to=2027-01-31&bucket=month',
      '?from=2027-01-01&to=2027-01-31&bucket=week',
    ]) {
      expect((await send('GET', `/summary/series${bad}`)).statusCode, bad).toBe(422);
    }
    expect((await h.call('GET', '/summary/series?from=2027-01-01&to=2027-01-02')).statusCode).toBe(
      401,
    );
  });

  test('without earnings or stops, earnings are null and the hours stay', async () => {
    await setup({ earnings: false, stops: false, tracking: false, replay: false });
    const body = (await send('GET', '/summary/series?from=2027-01-15&to=2027-01-15')).json();
    expect(body.buckets[0]).toMatchObject({ shift_count: 1, hours: 2, earnings_cents: null });
  });
});
