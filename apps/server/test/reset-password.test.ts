import { afterEach, beforeEach, expect, test } from 'vitest';
import { generateRecoveryKey } from '../src/index';
import { harness, owner, type Harness } from './support';

// Forgot the password, from the sign-in page: the recovery key proves it is the owner.
let h: Harness;
let cookie: string;
let key: string;
const reset = (recovery_key: string, new_password = 'a brand new secret') =>
  h.call('POST', '/auth/reset-password', { recovery_key, new_password });
const login = (password: string) =>
  h.call('POST', '/auth/login', { username: owner.username, password });

beforeEach(async () => {
  h = harness();
  ({ cookie, recoveryKey: key } = await h.signUp());
});
afterEach(() => h.close());

test('the right key sets the new password, signs out other browsers and signs this one in', async () => {
  const res = await reset(` ${key.toLowerCase()}\n`); // pasted with spaces, in any case
  expect(res.statusCode).toBe(204);
  const fresh = String(res.headers['set-cookie']).split(';')[0]!;
  expect((await h.call('GET', '/settings', undefined, { cookie: fresh })).statusCode).toBe(200);
  expect((await h.call('GET', '/settings', undefined, { cookie })).statusCode).toBe(401);
  expect((await login(owner.password)).statusCode).toBe(401);
  expect((await login('a brand new secret')).statusCode).toBe(204);
});

test('another key, a non-key or a short password changes nothing', async () => {
  const other = (await generateRecoveryKey()).identity;
  expect((await reset(other)).json().code).toBe('invalid_credentials');
  expect((await reset('hunter2')).json().code).toBe('invalid_credentials');
  expect((await reset(key, 'short')).statusCode).toBe(422);
  expect((await login(owner.password)).statusCode).toBe(204);
});

test('it also lifts a sign-in lockout', async () => {
  for (let i = 0; i < 5; i++) await login('wrong password');
  expect((await login(owner.password)).statusCode).toBe(429);
  expect((await reset(key)).statusCode).toBe(204);
  expect((await login('a brand new secret')).statusCode).toBe(204);
});

test('five wrong keys from one client are refused for 15 minutes', async () => {
  const other = (await generateRecoveryKey()).identity;
  for (let i = 0; i < 5; i++) await reset(other);
  const res = await reset(key);
  expect(res.statusCode).toBe(429);
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  h.clock.t += 15 * 60 * 1000 + 1;
  expect((await reset(key)).statusCode).toBe(204);
});
