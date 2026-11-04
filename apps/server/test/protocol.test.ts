import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadConfig, SERVER_VERSION } from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const get = (url: string, headers: object = { cookie }) =>
  h.app.inject({ url, headers: headers as Record<string, string> });

test('every response carries the server, api, instance and restore headers', async () => {
  const instance = h.db.prepare('SELECT instance_id FROM instance').pluck().get() as string;
  const responses = [
    await get('/api/v1/settings'), // 200
    await get('/api/v1/settings', {}), // 401
    await get('/api/v1/nope'), // 404
    await get('/healthz'),
    await h.call('POST', '/vehicles', { name: '' }, { cookie }), // 422
  ];
  for (const res of responses) {
    expect(res.headers).toMatchObject({
      'x-milewage-server': SERVER_VERSION,
      'x-milewage-api': '1',
      'x-milewage-instance': instance,
      'x-milewage-restore-gen': '0',
      'x-server-time': String(h.clock.t),
    });
  }
  h.db.prepare('UPDATE instance SET restore_generation = 3').run();
  expect((await get('/healthz')).headers['x-milewage-restore-gen']).toBe('3');
  expect(responses[0]?.headers['cache-control']).toBe('no-store');
  expect(responses[3]?.headers['cache-control']).toBeUndefined();
});

test('before setup there is no instance to name', async () => {
  const fresh = harness();
  const res = await fresh.app.inject('/api/v1/setup/status');
  expect([res.headers['x-milewage-api'], res.headers['x-milewage-instance']]).toEqual([
    '1',
    undefined,
  ]);
  await fresh.close();
});

test('general limit: 300 per minute per credential, 429 with Retry-After, RateLimit headers', async () => {
  h.clock.t += 60_000; // the bucket the sign-up used is full again
  const other = await h.pair(cookie); // costs the cookie one token; the bearer has its own allowance
  const first = await get('/api/v1/settings');
  expect(first.headers).toMatchObject({ 'ratelimit-limit': '300', 'ratelimit-remaining': '298' });
  for (let i = 1; i < 299; i++) await get('/api/v1/vehicles');
  const limited = await get('/api/v1/settings');
  expect([limited.statusCode, limited.json().code, limited.headers['retry-after']]).toEqual([
    429,
    'rate_limited',
    '1',
  ]);
  expect((await get('/healthz')).statusCode).toBe(200); // liveness is outside the limit
  expect((await get('/api/v1/settings', other.auth)).statusCode).toBe(200);
  h.clock.t += 1000; // 5 tokens a second
  expect((await get('/api/v1/settings')).statusCode).toBe(200);
});

test('telemetry limit: 60 per minute with a burst of 30, per device', async () => {
  const { auth } = await h.pair(cookie);
  const post = () =>
    h.app.inject({ method: 'POST', url: '/api/v1/telemetry/batch', headers: auth, payload: {} });
  for (let i = 0; i < 30; i++) expect((await post()).statusCode).toBe(422); // reached the handler
  const limited = await post();
  expect([limited.statusCode, limited.headers['retry-after']]).toEqual([429, '1']);
  h.clock.t += 1000;
  expect((await post()).statusCode).toBe(422);
  expect((await get('/api/v1/settings', auth)).statusCode).toBe(200); // general traffic is separate
});

test('clock skew is recorded per device, never fixed, and never blocks a request', async () => {
  const { auth } = await h.pair(cookie);
  const skewOf = async () =>
    (await h.call('GET', '/devices', undefined, { cookie })).json()[0].clock_skew_ms;
  expect(await skewOf()).toBeNull(); // never observed
  const seen = (offset: number | string) =>
    get('/api/v1/settings', { ...auth, 'x-client-time': String(h.clock.t + Number(offset)) });

  expect((await seen(300_000)).statusCode).toBe(200); // 5 minutes ahead
  expect(await skewOf()).toBe(300_000);
  expect((await seen(-600_000)).statusCode).toBe(200); // 10 minutes behind
  expect(await skewOf()).toBe(-600_000);
  await get('/api/v1/settings', { ...auth, 'x-client-time': 'soon' }); // junk is ignored
  expect(await skewOf()).toBe(-600_000);
  await seen(0); // the driver fixed the clock
  expect(await skewOf()).toBe(0);

  // Only the impossible is refused: more than 5 minutes ahead; the past is always accepted.
  const start = (started_at: number, client_id: string) =>
    h.call('POST', '/shifts', { client_id, vehicle_id: 1, started_at }, auth);
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  expect(
    (await start(h.clock.t + 6 * 60_000, '00000000-0000-4000-8000-000000000001')).statusCode,
  ).toBe(422);
  const old = await start(h.clock.t - 3 * 86_400_000, '00000000-0000-4000-8000-000000000002');
  expect([old.statusCode, old.json().started_at]).toEqual([201, h.clock.t - 3 * 86_400_000]); // stored as sent
});

test('X-Forwarded-For is believed only from a trusted proxy', async () => {
  const fail = async (app: Harness['app'], ip: string, user: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { host: 'mw.test', origin: 'http://mw.test', 'x-forwarded-for': ip },
        payload: { username: user, password: 'wrong password' },
      })
    ).statusCode;
  const trusting = harness({}, { trustProxy: ['127.0.0.1'] });
  for (let i = 0; i < 5; i++) expect(await fail(trusting.app, '1.1.1.1', `u${i}`)).toBe(401);
  expect(await fail(trusting.app, '1.1.1.1', 'u9')).toBe(429);
  expect(await fail(trusting.app, '2.2.2.2', 'u9')).toBe(401); // another client behind the proxy
  await trusting.close();

  for (let i = 0; i < 5; i++) expect(await fail(h.app, `3.3.3.${i}`, `u${i}`)).toBe(401);
  expect(await fail(h.app, '3.3.3.9', 'u9')).toBe(429); // header ignored: one address, the proxy

  const trust = (v?: string) => loadConfig({ MILEWAGE_TRUST_PROXY: v }).trustProxy;
  expect(trust('172.18.0.0/16, 127.0.0.1')).toEqual(['172.18.0.0/16', '127.0.0.1']);
  expect([trust('true'), trust()]).toEqual([true, []]);
});
