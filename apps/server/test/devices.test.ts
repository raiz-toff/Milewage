import { afterEach, beforeEach, expect, test } from 'vitest';
import { harness, TRACKING_OFF, type Harness } from './support';

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const web = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const redeem = (token: string, ip?: string) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/pairing/redeem',
    remoteAddress: ip,
    payload: { token, device_name: 'Pixel 8', platform: 'android' },
  });
const mint = async () => (await web('POST', '/pairing-tokens')).json().token as string;
async function pair() {
  const res = (await redeem(await mint())).json();
  return { id: res.device_id as number, auth: { authorization: `Bearer ${res.device_token}` } };
}

test('pairing: QR payload, one-time token, device credential and settings', async () => {
  const made = await h.call('POST', '/pairing-tokens', undefined, {
    cookie,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'mw.example.ts.net',
  });
  const { token, expires_at, qr_payload } = made.json();
  expect(token).toMatch(/^mwp_[A-Za-z0-9_-]{43}$/);
  expect(expires_at).toBe(h.clock.t + 600_000);
  expect(qr_payload).toBe(
    `milewage://pair?v=1&u=${encodeURIComponent('https://mw.example.ts.net')}&t=${token}`,
  );

  const ok = await redeem(token);
  expect(ok.statusCode).toBe(201);
  expect(ok.json().device_token).toMatch(/^mwd_[A-Za-z0-9_-]{43}$/);
  expect(ok.json().settings.modules.devices).toBe(true);
  const hash = h.db.prepare('SELECT token_hash FROM devices').pluck().get();
  expect(hash).toMatch(/^[0-9a-f]{64}$/); // only the hash is stored

  const used = await redeem(token);
  const unknown = await redeem('mwp_' + 'x'.repeat(43));
  const stale = await mint();
  h.clock.t += 600_001;
  const expired = await redeem(stale);
  for (const res of [used, unknown, expired]) {
    expect([res.statusCode, res.json().code]).toEqual([401, 'invalid_pairing_token']);
  }
  expect((await h.call('POST', '/pairing-tokens')).json().code).toBe('auth_required');
});

test('scope matrix: a device reads settings and vehicles, nothing else', async () => {
  const { auth } = await pair();
  const as = (method: string, url: string, payload?: object) =>
    h.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: auth, payload });
  for (const url of ['/settings', '/vehicles']) expect((await as('GET', url)).statusCode).toBe(200);
  const writes: [string, string, object?][] = [
    ['PATCH', '/settings', { stops_enabled: false }],
    ['POST', '/vehicles', { name: 'a', kind: 'car' }],
    ['GET', '/devices'],
    ['POST', '/pairing-tokens'],
    ['POST', '/auth/logout'],
  ];
  for (const [method, url, payload] of writes) {
    const res = await as(method, url, payload);
    expect([url, res.statusCode, res.json().code]).toEqual([url, 403, 'scope_forbidden']);
  }
  const bad = { authorization: 'Bearer mwd_' + 'A'.repeat(43) };
  const res = await h.app.inject({ url: '/api/v1/settings', headers: bad });
  expect([res.statusCode, res.json().code]).toEqual([401, 'auth_required']);
});

test('revoke: the next request is 401 device_revoked; idempotent; rename; list', async () => {
  const { id, auth } = await pair();
  const get = () => h.app.inject({ url: '/api/v1/settings', headers: auth });
  expect((await get()).statusCode).toBe(200);
  expect((await web('PATCH', `/devices/${id}`, { name: 'Work phone' })).json().name).toBe(
    'Work phone',
  );
  expect((await web('DELETE', `/devices/${id}`)).statusCode).toBe(204);
  expect((await web('DELETE', `/devices/${id}`)).statusCode).toBe(204);
  const res = await get();
  expect([res.statusCode, res.json().code]).toEqual([401, 'device_revoked']);
  const [row] = (await web('GET', '/devices')).json();
  expect(row).toMatchObject({ id, name: 'Work phone', platform: 'android', revoked_at: h.clock.t });
  expect((await web('DELETE', '/devices/99')).statusCode).toBe(404);
  expect((await web('PATCH', '/devices/99', { name: 'x' })).statusCode).toBe(404);
});

test('last_seen_at updates at most once a minute', async () => {
  const { id, auth } = await pair();
  const seen = () => h.db.prepare('SELECT last_seen_at FROM devices WHERE id = ?').pluck().get(id);
  const t0 = h.clock.t;
  await h.app.inject({ url: '/api/v1/settings', headers: auth });
  h.clock.t += 30_000;
  await h.app.inject({ url: '/api/v1/settings', headers: auth });
  expect(seen()).toBe(t0);
  h.clock.t += 30_000;
  await h.app.inject({ url: '/api/v1/settings', headers: auth });
  expect(seen()).toBe(h.clock.t);
});

test('redeem: 10 failures per 15 minutes per IP, then 429 with Retry-After', async () => {
  for (let i = 0; i < 10; i++) expect((await redeem('nope', '10.1.1.1')).statusCode).toBe(401);
  const blocked = await redeem(await mint(), '10.1.1.1');
  expect([blocked.statusCode, blocked.json().code]).toEqual([429, 'rate_limited']);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(800);
  expect((await redeem(await mint(), '10.1.1.2')).statusCode).toBe(201);
});

test('with the devices module off there are no pairing routes', async () => {
  const off = harness({ devices: false, ...TRACKING_OFF });
  const { cookie: c } = await off.signUp();
  expect((await off.call('POST', '/pairing-tokens', undefined, { cookie: c })).statusCode).toBe(
    404,
  );
  await off.close();
});
