import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const { token, expires_at, qr_payload, pair_url } = made.json();
  expect(token).toMatch(/^mwp_[A-Za-z0-9_-]{43}$/);
  expect(expires_at).toBe(h.clock.t + 600_000);
  expect(qr_payload).toBe(
    `milewage://pair?v=1&u=${encodeURIComponent('https://mw.example.ts.net')}&t=${token}`,
  );
  // What the QR shows: any camera opens the pair page; the token stays in the fragment.
  expect(pair_url).toBe(`https://mw.example.ts.net/pair#v=1&t=${token}`);
  expect(made.json()).toMatchObject({
    base_url: 'https://mw.example.ts.net',
    base_url_source: 'request',
  });

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

test('MILEWAGE_PUBLIC_URL is the address in the code, whatever address the browser is on', async () => {
  const c = harness({}, { publicUrl: 'https://box.tail1234.ts.net' });
  const { cookie: owner } = await c.signUp();
  const made = await c.call('POST', '/pairing-tokens', undefined, {
    cookie: owner,
    'x-forwarded-proto': 'http',
    'x-forwarded-host': '192.168.1.20:8080',
  });
  const { token, qr_payload, pair_url, base_url, base_url_source } = made.json();
  expect([base_url, base_url_source]).toEqual(['https://box.tail1234.ts.net', 'configured']);
  expect(pair_url).toBe(`https://box.tail1234.ts.net/pair#v=1&t=${token}`);
  expect(qr_payload).toContain(`u=${encodeURIComponent('https://box.tail1234.ts.net')}&`);
  await c.close();
});

test("the driver's corrected address is used once it is a bare https address", async () => {
  const ask = (base_url: unknown) => web('POST', '/pairing-tokens', { base_url });
  const ok = (await ask(' https://Box.tail1234.ts.net/ ')).json();
  expect([ok.base_url, ok.base_url_source]).toEqual(['https://box.tail1234.ts.net', 'driver']);
  expect(ok.pair_url).toBe(`https://box.tail1234.ts.net/pair#v=1&t=${ok.token}`);
  // Outside production a debug build may use plain http on the home network.
  expect((await ask('http://192.168.1.20:8080')).json().base_url).toBe('http://192.168.1.20:8080');
  for (const bad of [
    'box.ts.net',
    'ftp://box.ts.net',
    'https://u:p@box.ts.net',
    'https://box.ts.net/mw',
    'https://box.ts.net/?a=1',
    42,
  ]) {
    const res = await ask(bad);
    expect([res.statusCode, res.json().code], String(bad)).toEqual([422, 'validation_failed']);
  }
  expect(h.db.prepare('SELECT COUNT(*) FROM pairing_tokens').pluck().get()).toBe(2);
});

test('a production server refuses a plain http address from the driver', async () => {
  const p = harness({}, { httpAddressAllowed: false });
  const { cookie: owner } = await p.signUp();
  const res = await p.call(
    'POST',
    '/pairing-tokens',
    { base_url: 'http://192.168.1.20' },
    { cookie: owner },
  );
  expect([res.statusCode, res.json().detail]).toEqual([
    422,
    'The address must start with https://',
  ]);
  await p.close();
});

test('with the devices module off there are no pairing routes', async () => {
  const off = harness({ devices: false, sync: false, ...TRACKING_OFF });
  const { cookie: c } = await off.signUp();
  expect((await off.call('POST', '/pairing-tokens', undefined, { cookie: c })).statusCode).toBe(
    404,
  );
  await off.close();
});

test('the phone app download: none until the file is there, then the file, without sign-in', async () => {
  const get = (method: 'GET' | 'HEAD') => h.app.inject({ method, url: '/api/v1/app/android.apk' });
  expect([(await get('GET')).statusCode, (await get('GET')).json().code]).toEqual([
    404,
    'not_found',
  ]);
  expect((await get('HEAD')).statusCode).toBe(404); // the web hides "Get the app"
  mkdirSync(join(h.dir, 'config'), { recursive: true });
  writeFileSync(join(h.dir, 'config', 'milewage.apk'), 'PK-app');
  const ok = await get('GET');
  expect(ok.statusCode).toBe(200);
  expect(ok.headers['content-type']).toBe('application/vnd.android.package-archive');
  expect(ok.headers['content-disposition']).toBe('attachment; filename="milewage.apk"');
  expect(ok.body).toBe('PK-app');
  expect((await get('HEAD')).statusCode).toBe(200);
});

test('the download page info: no sign-in, the file read at request time, its version', async () => {
  const info = async (headers: Record<string, string> = {}) =>
    (await h.app.inject({ method: 'GET', url: '/api/v1/app', headers })).json();
  const first = await h.app.inject({ method: 'GET', url: '/api/v1/app' });
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.json()).toEqual({
    apk: null,
    store_url: null,
    page_url: 'http://localhost:80/app',
    base_url: 'http://localhost:80',
    base_url_source: 'request',
  });
  // Through Caddy and `tailscale serve`: the page is offered at the Tailscale address.
  const ts = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mw.example.ts.net' };
  expect((await info(ts)).page_url).toBe('https://mw.example.ts.net/app');
  // A build is put in place while the server runs: offered at once, no restart.
  const apk = join(h.dir, 'config', 'milewage.apk');
  mkdirSync(join(h.dir, 'config'), { recursive: true });
  writeFileSync(apk, 'PK-app-1');
  utimesSync(apk, 1_800_000_000, 1_800_000_000);
  expect((await info()).apk).toEqual({
    size_bytes: 8,
    updated_at: 1_800_000_000_000,
    version: null,
  });
  writeFileSync(
    `${apk}.json`,
    JSON.stringify({ version: '0.1.0', built_at: '2026-11-07T18:04:00Z' }),
  );
  expect((await info()).apk.version).toBe('0.1.0');
  writeFileSync(`${apk}.json`, JSON.stringify({ version: '<script>' }));
  expect((await info()).apk.version).toBeNull();
});

test('the store link and the configured address are offered when set', async () => {
  const s = harness(
    {},
    {
      appStoreUrl: 'https://play.google.com/store/apps/details?id=app.milewage',
      publicUrl: 'https://box.tail1234.ts.net',
    },
  );
  const res = (await s.app.inject({ method: 'GET', url: '/api/v1/app' })).json();
  expect(res).toMatchObject({
    store_url: 'https://play.google.com/store/apps/details?id=app.milewage',
    page_url: 'https://box.tail1234.ts.net/app',
    base_url_source: 'configured',
  });
  await s.close();
});

test('re-pairing makes a new device row, so a restarted seq never meets the old points', async () => {
  await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
  const t0 = h.clock.t;
  const first = await pair();
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, first.auth);
  const send = (auth: { authorization: string }, seq: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/batch',
      headers: auth,
      payload: {
        shift_client_id: SHIFT,
        points: [{ seq, recorded_at: t0 + 1000, lat_e7: 1, lon_e7: 1, accuracy_m: 5 }],
      },
    });
  expect((await send(first.auth, 1)).json().inserted).toBe(1);
  expect((await send(first.auth, 1)).json().duplicates).toBe(1); // same device, same seq

  // Pairing again (a new phone, or one with its data cleared): a new id, never the old one.
  const second = await pair();
  expect(second.id).not.toBe(first.id);
  expect((await send(second.auth, 1)).json()).toMatchObject({ inserted: 1, duplicates: 0 });
  const ids = h.db.prepare('SELECT device_id FROM telemetry_points ORDER BY id').pluck().all();
  expect(ids).toEqual([first.id, second.id]);

  // Re-pairing does not revoke the old row by itself; the owner revokes it (DELETE /devices/:id).
  const settings = (auth: { authorization: string }) =>
    h.app.inject({ url: '/api/v1/settings', headers: auth });
  expect((await settings(first.auth)).statusCode).toBe(200);
  await web('DELETE', `/devices/${first.id}`);
  expect((await settings(first.auth)).json().code).toBe('device_revoked');
  expect((await settings(second.auth)).statusCode).toBe(200);
});
