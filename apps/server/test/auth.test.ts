import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp, createServerModules, openAndMigrate, type Db } from '../src/index';

const DAY = 24 * 60 * 60 * 1000;
const owner = {
  username: 'sam',
  password: 'correct horse battery',
  country: 'us',
  distance_unit: 'mi',
  currency: 'usd',
  timezone: 'America/Chicago',
};

let dir: string;
let db: Db;
let t: number;
let app: ReturnType<typeof buildApp>['fastify'];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-auth-'));
  db = openAndMigrate(join(dir, 'milewage.db'));
  t = 1_800_000_000_000;
  const modules = createServerModules({ db, now: () => t, configDir: join(dir, 'config') });
  app = buildApp({ modules, enabled: { core: true }, logLevel: 'silent' }).fastify;
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const headers = { host: 'mw.test', origin: 'http://mw.test' };
const post = (url: string, payload: object, cookie?: string, ip?: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    payload,
    remoteAddress: ip,
    headers: cookie ? { ...headers, cookie } : headers,
  });
const login = (password: string, ip?: string, username = 'sam') =>
  post('/auth/login', { username, password }, undefined, ip);
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie']).split(';')[0] as string;
const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
const signUp = async () => {
  const res = await post('/setup', owner);
  const cookie = cookieOf(res);
  await post('/setup/confirm', { last6: res.json().recovery_key.slice(-6) }, cookie);
  return cookie;
};

test('setup creates the owner once: user, settings, instance, hashed password, session', async () => {
  expect((await app.inject('/api/v1/setup/status')).json()).toEqual({ state: 'needs_setup' });
  const res = await post('/setup', owner);
  expect(res.statusCode).toBe(201);
  expect(res.json()).toEqual({
    recovery_key: expect.stringMatching(/^AGE-SECRET-KEY-1[A-Z0-9]+$/),
    state: 'needs_confirmation',
  });
  // An http page (the home address): no Secure, or the browser would drop the cookie (plan 28).
  expect(String(res.headers['set-cookie'])).toMatch(/^mw_session=.+; HttpOnly; SameSite=Strict/);
  const hash = db.prepare('SELECT password_hash FROM users').pluck().get() as string;
  expect(hash).toMatch(/^scrypt\$/);
  expect([count('instance'), count('web_sessions')]).toEqual([1, 1]);

  const second = await post('/setup', { ...owner, username: 'eve' });
  expect([second.statusCode, second.json().code]).toEqual([409, 'setup_already_done']);
});

test('the session cookie is Secure when the page is https, and only then (plan 28)', async () => {
  await signUp();
  const cookieFrom = (h: Record<string, string>, behindProxy = false) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'sam', password: owner.password },
      headers: { host: 'mw.test', ...h },
      remoteAddress: behindProxy ? '172.29.88.2' : undefined,
    });
  const https = await cookieFrom({ origin: 'https://mw.test' });
  expect(String(https.headers['set-cookie'])).toMatch(/; HttpOnly; Secure; SameSite=Strict;/);
  const http = await cookieFrom({ origin: 'http://mw.test' });
  expect(http.statusCode).toBe(204);
  expect(String(http.headers['set-cookie'])).not.toMatch(/Secure/);
  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { host: 'mw.test', origin: 'https://mw.test', cookie: cookieOf(https) },
  });
  expect(String(logout.headers['set-cookie'])).toMatch(
    /^mw_session=; HttpOnly; Secure;.*Max-Age=0/,
  );
});

test('behind the trusted proxy, X-Forwarded-Proto https makes the cookie Secure', async () => {
  const modules = createServerModules({ db, now: () => t, configDir: join(dir, 'config') });
  const proxied = buildApp({
    modules,
    enabled: { core: true },
    logLevel: 'silent',
    trustProxy: ['172.29.88.0/24'],
  }).fastify;
  await signUp();
  const login = (ip: string) =>
    proxied.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'sam', password: owner.password },
      headers: { host: 'mw.test', origin: 'http://mw.test', 'x-forwarded-proto': 'https' },
      remoteAddress: ip,
    });
  expect(String((await login('172.29.88.2')).headers['set-cookie'])).toMatch(/; Secure;/);
  // Not from the proxy: the header is not believed.
  expect(String((await login('192.168.1.42')).headers['set-cookie'])).not.toMatch(/Secure/);
  await proxied.close();
});

test('wrong password and unknown user give the same 401', async () => {
  await signUp();
  const wrong = await login('nope nope nope');
  const unknown = await login('nope nope nope', undefined, 'ghost');
  expect([wrong.statusCode, wrong.json().code]).toEqual([401, 'invalid_credentials']);
  expect({ ...unknown.json(), request_id: 0 }).toEqual({ ...wrong.json(), request_id: 0 });
});

test('logout ends the session; cookie routes need a matching Origin', async () => {
  const cookie = await signUp();
  const evil = { host: 'mw.test', origin: 'http://evil.test', cookie };
  const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: evil });
  expect([bad.statusCode, bad.json().code]).toEqual([403, 'origin_mismatch']);
  expect((await post('/auth/logout', {}, cookie)).statusCode).toBe(204);
  expect((await post('/auth/logout', {}, cookie)).json().code).toBe('auth_required');
});

test('sessions expire after 30 idle days and slide while used', async () => {
  await signUp();
  const cookie = cookieOf(await login(owner.password));
  const use = async () =>
    (
      await post('/auth/password', { current_password: 'x', new_password: 'y'.repeat(10) }, cookie)
    ).json().code;
  t += 20 * DAY;
  expect(await use()).toBe('invalid_credentials'); // session valid, expiry renewed
  t += 20 * DAY;
  expect(await use()).toBe('invalid_credentials'); // 40 days after login, 20 after the last use
  t += 31 * DAY;
  expect(await use()).toBe('session_expired');
});

test('brute force: 5 failures per 15 minutes per IP and per account, then 429 with Retry-After', async () => {
  await signUp();
  for (let i = 0; i < 5; i++) expect((await login('wrong wrong', '10.0.0.1')).statusCode).toBe(401);
  const blocked = await login(owner.password, '10.0.0.1'); // even the right password is refused
  expect([blocked.statusCode, blocked.json().code]).toEqual([429, 'rate_limited']);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(800);
  expect((await login(owner.password, '10.0.0.2')).statusCode).toBe(429); // same account, other IP
  expect((await login('x', '10.0.0.1', 'ghost')).statusCode).toBe(429); // same IP, other account
  t += 15 * 60 * 1000 + 1;
  expect((await login(owner.password, '10.0.0.1')).statusCode).toBe(204);
});

test('changing the password ends other sessions and swaps the credential', async () => {
  const current = await signUp();
  const other = cookieOf(await login(owner.password));
  const fresh = 'a brand new password';
  const change = (cur: string) =>
    post('/auth/password', { current_password: cur, new_password: fresh }, current);
  expect((await change('bad')).statusCode).toBe(401);
  expect((await change(owner.password)).statusCode).toBe(204);
  expect((await post('/auth/logout', {}, other)).statusCode).toBe(401);
  expect((await post('/auth/logout', {}, current)).statusCode).toBe(204);
  expect((await login(owner.password)).statusCode).toBe(401);
  expect((await login(fresh)).statusCode).toBe(204);
});
