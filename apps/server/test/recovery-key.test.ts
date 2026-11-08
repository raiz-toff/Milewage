import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createBackupRepository, decryptStream, recipientOf } from '../src/index';
import { harness, owner, type Harness } from './support';

// A lost or leaked recovery key (10 section 9 "Rotation"): a new key protects new backups only.

let h: Harness;
let cookie: string;
let oldKey: string;
beforeEach(async () => {
  h = harness();
  ({ cookie, recoveryKey: oldKey } = await h.signUp());
});
afterEach(() => h.close());

const secrets = () => JSON.parse(readFileSync(join(h.dir, 'config', 'secrets.json'), 'utf8'));
const readAll = async (s: Readable) => Buffer.concat(await s.toArray());
/** The database inside backup `id`, opened with `key`; rejects when the key does not fit. */
async function open(id: number, key: string) {
  const row = createBackupRepository(h.db).byId(id)!;
  const bytes = readFileSync(join(h.dir, 'backups', row.fileName));
  return gunzipSync(await readAll(await decryptStream(Readable.from(bytes), key)));
}
const opens = (id: number, key: string) =>
  open(id, key).then(
    (db) => db.subarray(0, 15).toString() === 'SQLite format 3',
    () => false,
  );
const makeKey = (password = owner.password) =>
  h.call('POST', '/backups/recovery-key', { password }, { cookie });
const confirm = (last6: string) =>
  h.call('POST', '/backups/recovery-key/confirm', { last6 }, { cookie });
const backUpNow = async () => {
  h.clock.t += 60_000; // backup files are named by the clock
  const res = await h.call('POST', '/backups', undefined, { cookie });
  expect(res.statusCode).toBe(201);
  return res.json().id as number;
};

describe('a new recovery key', () => {
  test('a wrong password is refused and changes nothing; after 5 it waits', async () => {
    const before = secrets();
    const res = await makeKey('not my password');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_credentials');
    expect(res.json()).not.toHaveProperty('recovery_key');
    expect(secrets()).toEqual(before);
    for (let i = 0; i < 4; i++) await makeKey('not my password');
    const limited = await makeKey();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    h.clock.t += 15 * 60_000;
    expect((await makeKey()).statusCode).toBe(201);
  });

  test('needs a web session and the password field', async () => {
    expect((await h.call('POST', '/backups/recovery-key', { password: 'x' })).statusCode).toBe(401);
    const phone = await h.pair(cookie);
    const fromPhone = await h.call(
      'POST',
      '/backups/recovery-key',
      { password: owner.password },
      phone.auth,
    );
    expect(fromPhone.statusCode).toBe(403);
    expect((await h.call('POST', '/backups/recovery-key', {}, { cookie })).statusCode).toBe(422);
  });

  test('the key is shown once and only its public half is ever stored', async () => {
    const res = await makeKey();
    expect(res.statusCode).toBe(201);
    const { recovery_key: newKey, state } = res.json();
    expect(state).toBe('needs_confirmation');
    expect(newKey).toMatch(/^AGE-SECRET-KEY-1/);
    expect(newKey).not.toBe(oldKey);
    // Not stored before the confirmation, and after it only the public key.
    expect(secrets().age_public_key).toBe(await recipientOf(oldKey));
    expect((await confirm(newKey.slice(-6))).statusCode).toBe(200);
    expect(secrets()).toEqual({ age_public_key: await recipientOf(newKey) });
    expect(JSON.stringify(secrets())).not.toContain(newKey);
    // Nothing can show it again: a second confirmation finds no key waiting.
    expect((await confirm(newKey.slice(-6))).statusCode).toBe(422);
  });

  test('until it is confirmed, backups still use the old key', async () => {
    const newKey = (await makeKey()).json().recovery_key as string;
    const id = await backUpNow();
    expect(await opens(id, oldKey)).toBe(true);
    expect(await opens(id, newKey)).toBe(false);
    // A wrong tail is refused and the old key stays.
    const wrong = await confirm('ZZZZZZ');
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().errors[0].path).toBe('/last6');
    expect(secrets().age_public_key).toBe(await recipientOf(oldKey));
  });

  test('once confirmed, a backup is made at once with the new key, and later ones too', async () => {
    const before = await backUpNow();
    const newKey = (await makeKey()).json().recovery_key as string;
    h.clock.t += 60_000;
    const res = await confirm(newKey.slice(-6).toLowerCase());
    expect(res.statusCode).toBe(200);
    const { state, backup } = res.json();
    expect(state).toBe('ready');
    expect(backup).toMatchObject({ integrity_ok: true, trigger: 'manual' });
    expect(backup.id).not.toBe(before);
    expect(await opens(backup.id, newKey)).toBe(true);
    expect(await opens(backup.id, oldKey)).toBe(false);
    // It is in the list like any other backup.
    const list = (await h.call('GET', '/backups', undefined, { cookie })).json();
    expect(list.map((b: { id: number }) => b.id)).toContain(backup.id);
    h.clock.t += 15 * 60_000;
    const later = await backUpNow();
    expect(await opens(later, newKey)).toBe(true);
  });

  test('a backup made before the change still needs the old key', async () => {
    const before = await backUpNow();
    // A day later: retention keeps only the newest backup of a day, so the same day would drop it.
    h.clock.t += 24 * 60 * 60_000;
    const newKey = (await makeKey()).json().recovery_key as string;
    await confirm(newKey.slice(-6));
    expect(await opens(before, newKey)).toBe(false);
    expect(await opens(before, oldKey)).toBe(true);
  });

  test('a backup already running when the key is confirmed does not stand in for the new one', async () => {
    const newKey = (await makeKey()).json().recovery_key as string;
    // The two backups run back to back; a ticking clock gives their files different names.
    let t = h.clock.t + 60_000;
    Object.defineProperty(h.clock, 't', { get: () => (t += 1), set: (v: number) => (t = v) });
    const running = h.call('POST', '/backups', undefined, { cookie });
    const confirmed = confirm(newKey.slice(-6));
    const [first, second] = await Promise.all([running, confirmed]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const backup = second.json().backup;
    expect(backup.id).not.toBe(first.json().id);
    expect(await opens(backup.id, newKey)).toBe(true);
  });

  test('a second request replaces a key that was never confirmed', async () => {
    const first = (await makeKey()).json().recovery_key as string;
    const second = (await makeKey()).json().recovery_key as string;
    h.clock.t += 60_000;
    expect((await confirm(first.slice(-6))).statusCode).toBe(422);
    expect((await confirm(second.slice(-6))).statusCode).toBe(200);
    expect(secrets().age_public_key).toBe(await recipientOf(second));
  });
});
