import { afterEach, beforeEach, expect, test } from 'vitest';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness(
    {},
    { homeUrl: 'http://192.168.1.20:8080', publicUrl: 'https://box.tail1234.ts.net' },
  );
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const phone = (url: string, payload: object, ip = '192.168.1.42') =>
  h.app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: ip });
const ask = (ip?: string, device_name = 'Galaxy S24') =>
  phone('/link-requests', { device_name, platform: 'android' }, ip);
const poll = (device_code: string) => phone('/link-requests/poll', { device_code });
const web = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });

test('a phone asks, the driver types its code on the web, the phone gets its credential once', async () => {
  const made = await ask();
  expect(made.statusCode).toBe(201);
  const { device_code, user_code, expires_in, interval } = made.json();
  expect(device_code).toMatch(/^mwl_[A-Za-z0-9_-]{43}$/);
  expect(user_code).toMatch(/^\d{6}$/);
  expect([expires_in, interval]).toEqual([600, 2]);

  const pending = await poll(device_code);
  expect([pending.statusCode, pending.json()]).toEqual([202, { status: 'pending' }]);

  // The web lists the waiting phone, never its codes.
  const list = (await web('GET', '/link-requests')).json();
  expect(list).toEqual([
    {
      id: 1,
      device_name: 'Galaxy S24',
      platform: 'android',
      from: '192.168.1.42',
      created_at: h.clock.t,
      expires_at: h.clock.t + 600_000,
    },
  ]);
  expect(JSON.stringify(list)).not.toContain(user_code);

  const ok = await web('POST', '/link-requests/approve', {
    user_code: `${user_code.slice(0, 3)} ${user_code.slice(3)}`,
  });
  expect([ok.statusCode, ok.json()]).toEqual([200, { id: 1, device_name: 'Galaxy S24' }]);
  expect((await web('GET', '/link-requests')).json()).toEqual([]); // approved, no longer waiting

  h.clock.t += 2_000;
  const linked = await poll(device_code);
  expect(linked.statusCode).toBe(201);
  expect(linked.json()).toMatchObject({
    device_id: 1,
    device_token: expect.stringMatching(/^mwd_/),
    settings: expect.objectContaining({ country: expect.any(String) }),
    home_url: 'http://192.168.1.20:8080',
    away_url: 'https://box.tail1234.ts.net',
  });
  // The credential works, and the phone is an ordinary device on the Devices page.
  const auth = { authorization: `Bearer ${linked.json().device_token}` };
  expect((await h.app.inject({ url: '/api/v1/settings', headers: auth })).statusCode).toBe(200);
  expect((await web('GET', '/devices')).json()[0]).toMatchObject({ name: 'Galaxy S24' });

  h.clock.t += 2_000;
  const again = await poll(device_code);
  expect([again.statusCode, again.json().code]).toEqual([410, 'link_expired']);
});

test('polling faster than the interval is slow_down; unknown and expired codes are gone', async () => {
  const { device_code } = (await ask()).json();
  expect((await poll(device_code)).statusCode).toBe(202);
  const fast = await poll(device_code);
  expect([fast.statusCode, fast.json().code, fast.headers['retry-after']]).toEqual([
    429,
    'slow_down',
    '2',
  ]);
  expect((await poll('mwl_' + 'x'.repeat(43))).json().code).toBe('link_expired');
  h.clock.t += 600_001;
  const late = await poll(device_code);
  expect([late.statusCode, late.json().code]).toEqual([410, 'link_expired']);
  expect((await web('GET', '/link-requests')).json()).toEqual([]);
});

test('wrong codes: refused, and 10 per 15 minutes per driver', async () => {
  const { user_code } = (await ask()).json();
  const wrong = String((Number(user_code) + 1) % 1_000_000).padStart(6, '0');
  const res = await web('POST', '/link-requests/approve', { user_code: wrong });
  expect([res.statusCode, res.json().code]).toEqual([422, 'invalid_link_code']);
  for (let i = 0; i < 9; i++) await web('POST', '/link-requests/approve', { user_code: wrong });
  const blocked = await web('POST', '/link-requests/approve', { user_code });
  expect([blocked.statusCode, blocked.json().code]).toEqual([429, 'rate_limited']);
});

test('Not my phone: the request is dropped and its next poll is gone', async () => {
  const { device_code } = (await ask()).json();
  expect((await web('DELETE', '/link-requests/1')).statusCode).toBe(204);
  expect((await poll(device_code)).json().code).toBe('link_expired');
});

test('the web routes need a signed-in session; the phone routes need none', async () => {
  for (const [method, url, payload] of [
    ['GET', '/link-requests'],
    ['POST', '/link-requests/approve', { user_code: '123456' }],
    ['DELETE', '/link-requests/1'],
  ] as const) {
    const res = await h.call(method, url, payload);
    expect([url, res.json().code]).toEqual([url, 'auth_required']);
  }
});

test('at most 5 waiting phones per address and 20 in all; codes are unique', async () => {
  const codes = new Set<string>();
  for (let i = 0; i < 5; i++) codes.add((await ask('192.168.1.50')).json().user_code);
  const sixth = await ask('192.168.1.50');
  expect([sixth.statusCode, sixth.json().code]).toEqual([429, 'rate_limited']);
  for (let i = 0; i < 15; i++) codes.add((await ask(`192.168.2.${i}`)).json().user_code);
  expect(codes.size).toBe(20);
  expect((await ask('192.168.3.1')).statusCode).toBe(429);
  h.clock.t += 600_001; // they expire and make room
  expect((await ask('192.168.3.1')).statusCode).toBe(201);
});

test('bad bodies are refused', async () => {
  expect((await phone('/link-requests', { device_name: '', platform: 'android' })).statusCode).toBe(
    422,
  );
  expect((await phone('/link-requests', { device_name: 'x', platform: 'web' })).statusCode).toBe(
    422,
  );
  expect((await phone('/link-requests/poll', {})).statusCode).toBe(422);
});
