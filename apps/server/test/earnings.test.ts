import { afterEach, describe, expect, test } from 'vitest';
import { loadCommaOptions } from '../src/comma-options';
import { ConfigError } from '../src/config';
import { harness, type Harness } from './support';

// 18 section 4.3: the driver's typed total per shift and platform, and the effective earnings.
let h: Harness;
let cookie: string;
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });

async function setup(...args: Parameters<typeof harness>) {
  h = harness(...args);
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
}

/** An ended shift with one dropoff stop; `label` puts a DoorDash label (payout 1000, tip 200) on it. */
async function shiftWithStop(clientId: string, label = true, status: 'ended' | 'active' = 'ended') {
  const created = await send('POST', '/shifts', {
    client_id: clientId,
    vehicle_id: 1,
    started_at: h.clock.t,
  });
  const id = created.json().id as number;
  if (status === 'ended') {
    h.db
      .prepare("UPDATE shifts SET status = 'ended', ended_at = ?, total_m = 1000 WHERE id = ?")
      .run(h.clock.t + 3_600_000, id);
  }
  h.db
    .prepare(
      "INSERT INTO stops (user_id, shift_id, stop_key, started_at, ended_at, dwell_s, lat_e7, lon_e7, confidence, est_role, role) VALUES (1, ?, 'k1', ?, ?, 60, 0, 0, 'high', 'dropoff', 'none')",
    )
    .run(id, h.clock.t, h.clock.t + 60_000);
  if (label) {
    await send('PUT', `/shifts/${id}/stop-labels/k1`, {
      role: 'dropoff',
      platform: 'doordash',
      payout_cents: 1000,
      tip_cents: 200,
      edited_at: h.clock.t,
    });
  }
  return id;
}
const A = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
const range = '?from=2027-01-01&to=2027-01-31';
const summary = async (q = '') => (await send('GET', `/summary${range}${q}`)).json();

describe('typed earnings', () => {
  test('upsert, the typed total replaces that platform label sum, delete brings the labels back', async () => {
    await setup();
    const id = await shiftWithStop(A);
    expect(await summary()).toMatchObject({ earnings_cents: 1200, tips_cents: 200 });

    const put = await send('PUT', `/shifts/${id}/earnings/doordash`, {
      gross_cents: 3000,
      tips_cents: 500,
      bonus_cents: 250,
      orders: 7,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().effective).toEqual([
      expect.objectContaining({
        platform: 'doordash',
        total_cents: 3750,
        orders: 7,
        source: 'entered',
      }),
    ]);
    expect(put.json().labels).toEqual([
      { platform: 'doordash', payout_cents: 1000, tip_cents: 200, dropoffs: 1 },
    ]);
    expect(await summary()).toMatchObject({ earnings_cents: 3750, tips_cents: 500 });
    const again = await send('PUT', `/shifts/${id}/earnings/doordash`, { gross_cents: 3000 });
    expect(again.json().entries).toHaveLength(1); // one row per shift and platform
    expect((await send('GET', `/shifts/${id}/earnings`)).json().entries[0].tips_cents).toBe(0);

    await send('DELETE', `/shifts/${id}/earnings/doordash`);
    await send('DELETE', `/shifts/${id}/earnings/doordash`); // idempotent
    expect(await summary()).toMatchObject({ earnings_cents: 1200 });
  });

  test('another platform is added to the labels, not replaced; the platform filter is earnings-only', async () => {
    await setup();
    const id = await shiftWithStop(A);
    await send('PUT', `/shifts/${id}/earnings/ubereats`, { gross_cents: 800 });
    expect(await summary()).toMatchObject({ earnings_cents: 2000 });
    const filtered = await summary('&platform=ubereats');
    expect(filtered).toMatchObject({
      earnings_cents: 800,
      platform_filter: 'earnings_only',
      shift_count: 1,
    });
    expect((await summary()).platform_filter).toBeUndefined();
  });

  test('works with stops off and with no labels; nothing entered is null, never 0', async () => {
    await setup();
    const id = await shiftWithStop(A, false);
    expect(await summary()).toMatchObject({ earnings_cents: null, hourly_earnings_cents: null });
    await send('PATCH', '/settings', { stops_enabled: false });
    await send('PUT', `/shifts/${id}/earnings/other`, { gross_cents: 4500 });
    const s = await summary();
    expect(s.earnings_cents).toBe(4500);
    expect(s.hourly_earnings_cents).toBe(4500); // one hour
  });

  test('rules: an active shift, unknown platforms and bad amounts are refused', async () => {
    await setup();
    const active = await shiftWithStop(A, false, 'active');
    const r = await send('PUT', `/shifts/${active}/earnings/doordash`, { gross_cents: 1 });
    expect([r.statusCode, r.json().code]).toEqual([409, 'shift_not_ended']);
    h.db
      .prepare("UPDATE shifts SET status = 'ended', ended_at = ? WHERE id = ?")
      .run(h.clock.t + 1, active);
    for (const [path, body] of [
      ['nosuch', { gross_cents: 1 }],
      ['doordash', { gross_cents: -1 }],
      ['doordash', { orders: 1.5 }],
      ['doordash', { surprise: 1 }],
    ] as const) {
      expect((await send('PUT', `/shifts/${active}/earnings/${path}`, body)).statusCode, path).toBe(
        422,
      );
    }
    expect((await send('PUT', '/shifts/99/earnings/doordash', {})).statusCode).toBe(404);
    expect((await h.call('GET', `/shifts/${active}/earnings`)).statusCode).toBe(401);
  });

  test('the shift CSV shows the effective figures and a Bonus column; blank without any', async () => {
    await setup();
    const id = await shiftWithStop(A);
    await send('PUT', `/shifts/${id}/earnings/doordash`, {
      gross_cents: 3000,
      tips_cents: 500,
      bonus_cents: 250,
    });
    const csv = (await send('GET', `/exports/csv${range}&level=shift`)).body.split('\r\n');
    const head = csv[0]!.split(',');
    const row = csv[1]!.split(',');
    const at = (name: string) => row[head.indexOf(name)];
    expect([at('Gross_Pay'), at('Tips'), at('Bonus'), at('Platform')]).toEqual([
      '30.00',
      '5.00',
      '2.50',
      'doordash',
    ]);
  });
});

describe('the override rule is a setting, not code (18 section 17)', () => {
  test('comma.earnings_override = sum adds the typed total to the label sum', async () => {
    await setup({}, { comma: { earningsOverride: 'sum' } });
    const id = await shiftWithStop(A);
    const put = await send('PUT', `/shifts/${id}/earnings/doordash`, { gross_cents: 3000 });
    expect(put.json().effective[0]).toMatchObject({ total_cents: 4200, source: 'mixed' });
  });

  test('config parsing: file, environment, and bad values', () => {
    expect(loadCommaOptions({}).earningsOverride).toBe('replace');
    expect(loadCommaOptions({ comma: { earnings_override: 'sum' } }).earningsOverride).toBe('sum');
    expect(loadCommaOptions({}, { MILEWAGE_EARNINGS_OVERRIDE: 'sum' }).earningsOverride).toBe(
      'sum',
    );
    expect(loadCommaOptions({}).taxCountries).toEqual(['CA']);
    expect(loadCommaOptions({}, { MILEWAGE_TAX_COUNTRIES: 'ca, us' }).taxCountries).toEqual([
      'CA',
      'US',
    ]);
    expect(loadCommaOptions({}).challengeTargetCents).toBe(50_000);
    expect(() => loadCommaOptions({ comma: { earnings_override: 'x' } })).toThrow(ConfigError);
    expect(() => loadCommaOptions({ comma: { challenge_target_cents: 0 } })).toThrow(ConfigError);
  });
});

describe('module off', () => {
  test('earnings off: routes 404, flag false, and the summary uses labels only', async () => {
    await setup({ earnings: false });
    const id = await shiftWithStop(A);
    expect(
      (await send('PUT', `/shifts/${id}/earnings/doordash`, { gross_cents: 1 })).statusCode,
    ).toBe(404);
    expect((await send('GET', '/settings')).json().modules.earnings).toBe(false);
    expect(await summary()).toMatchObject({ earnings_cents: 1200 });
  });
});
