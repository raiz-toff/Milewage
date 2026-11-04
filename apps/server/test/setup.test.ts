import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ageCodec,
  buildBackupService,
  decryptStream,
  fileSecrets,
  generateRecoveryKey,
  keyTail,
  recipientOf,
} from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
beforeEach(() => void (h = harness()));
afterEach(() => h.close());

const readAll = async (s: Readable) => Buffer.concat(await s.toArray());
const secretsPath = () => join(h.dir, 'config', 'secrets.json');
const service = () =>
  buildBackupService({
    db: h.db,
    now: () => h.clock.t,
    backupDir: join(h.dir, 'backups'),
    configDir: join(h.dir, 'config'),
  });
const sam = { username: 'sam', password: 'correct horse battery' };

describe('recovery key at setup (10 section 4, 08 section 2.3)', () => {
  test('setup returns the key once and stores only the public key', async () => {
    const { cookie, recoveryKey } = await h.signUpUnconfirmed();
    expect(recoveryKey).toMatch(/^AGE-SECRET-KEY-1[A-Z0-9]{50,}$/);
    expect((await h.call('GET', '/setup/status')).json()).toEqual({ state: 'needs_confirmation' });
    const secrets = JSON.parse(readFileSync(secretsPath(), 'utf8'));
    expect(secrets.age_public_key).toBe(await recipientOf(recoveryKey));
    expect(statSync(secretsPath()).mode & 0o777).toBe(0o600);
    // The private key is nowhere on disk: not in config, not in the database files.
    const raw = (path: string) => readFileSync(path).toString('latin1');
    expect(raw(secretsPath())).not.toContain(recoveryKey);
    expect(raw(join(h.dir, 'milewage.db'))).not.toContain(recoveryKey);
    expect(raw(join(h.dir, 'milewage.db-wal'))).not.toContain(recoveryKey);
    expect(raw(secretsPath())).not.toContain(keyTail(recoveryKey)); // only a hash of the tail
    expect(cookie).toMatch(/^mw_session=/);
  });

  test('until the key is confirmed every route but a few is 403 setup_incomplete', async () => {
    const { cookie } = await h.signUpUnconfirmed();
    for (const [method, url] of [
      ['GET', '/settings'],
      ['GET', '/vehicles'],
      ['POST', '/pairing-tokens'],
      ['GET', '/backups'],
    ] as const) {
      const res = await h.call(method, url, undefined, { cookie });
      expect([url, res.statusCode, res.json().code]).toEqual([url, 403, 'setup_incomplete']);
    }
    expect((await h.call('GET', '/setup/status')).statusCode).toBe(200);
    expect((await h.app.inject('/healthz')).statusCode).toBe(200);
    expect((await h.call('POST', '/auth/logout', undefined, { cookie })).statusCode).toBe(204);
  });

  test('a driver who signed out before confirming can still sign in and confirm', async () => {
    const { cookie, recoveryKey } = await h.signUpUnconfirmed();
    await h.call('POST', '/auth/logout', undefined, { cookie });
    const login = await h.call('POST', '/auth/login', sam);
    expect(login.statusCode).toBe(204);
    const again = String(login.headers['set-cookie']).split(';')[0]!;
    const last6 = recoveryKey.slice(-6).toLowerCase();
    const done = await h.call('POST', '/setup/confirm', { last6 }, { cookie: again });
    expect(done.json()).toEqual({ state: 'ready' });
  });

  test('confirm: a wrong tail is 422 and changes nothing; the right one (any case) opens the API', async () => {
    const { cookie, recoveryKey } = await h.signUpUnconfirmed();
    const confirm = (last6: string, headers: object = { cookie }) =>
      h.call('POST', '/setup/confirm', { last6 }, headers);
    const bad = await confirm('AAAAAA');
    expect([bad.statusCode, bad.json().code, bad.json().errors[0].path]).toEqual([
      422,
      'validation_failed',
      '/last6',
    ]);
    expect((await h.call('GET', '/setup/status')).json()).toEqual({ state: 'needs_confirmation' });
    expect((await confirm('abc')).statusCode).toBe(422);
    expect((await confirm(recoveryKey.slice(-6), {})).statusCode).toBe(401);

    expect((await confirm(recoveryKey.slice(-6).toLowerCase())).json()).toEqual({ state: 'ready' });
    expect((await h.call('GET', '/setup/status')).json()).toEqual({ state: 'ready' });
    expect((await h.call('GET', '/settings', undefined, { cookie })).statusCode).toBe(200);
    const kept = Object.keys(JSON.parse(readFileSync(secretsPath(), 'utf8')));
    expect(kept).toEqual(['age_public_key']);
    expect((await confirm('AAAAAA')).json()).toEqual({ state: 'ready' }); // harmless a second time
  });

  test('scheduled backups wait for the confirmation', async () => {
    const { cookie, recoveryKey } = await h.signUpUnconfirmed();
    const svc = service();
    expect(await svc.run('nightly')).toBeUndefined();
    await h.call('POST', '/setup/confirm', { last6: recoveryKey.slice(-6) }, { cookie });
    expect(await svc.run('nightly')).toMatchObject({ trigger: 'nightly' });
  });
});

describe('age encryption of backups', () => {
  test('round trip: the file decrypts with the recovery key to a valid database', async () => {
    const { recoveryKey } = await h.signUp();
    const row = (await service().run('manual'))!;
    const file = join(h.dir, 'backups', row.fileName);
    expect(row.fileName).toMatch(/\.db\.gz\.age$/);
    expect(readFileSync(file).subarray(0, 21).toString()).toBe('age-encryption.org/v1');
    const sealed = createReadStream(file);
    const plain = gunzipSync(await readAll(await decryptStream(sealed, recoveryKey)));
    const copy = join(h.dir, 'restored.db');
    writeFileSync(copy, plain);
    const db = new Database(copy, { readonly: true });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.prepare('SELECT username FROM users').pluck().get()).toBe('sam');
    db.close();
  });

  test('the wrong key cannot open it', async () => {
    await h.signUp();
    const row = (await service().run('manual'))!;
    const other = await generateRecoveryKey();
    const sealed = createReadStream(join(h.dir, 'backups', row.fileName));
    await expect(
      decryptStream(sealed, other.identity).then((plain) => readAll(plain)),
    ).rejects.toThrow();
  });

  test('no key configured: the backup fails and no plain file is written', async () => {
    await h.signUp();
    fileSecrets(join(h.dir, 'config')).write({ age_public_key: '' });
    await expect(service().run('manual')).rejects.toMatchObject({ reason: 'no_key' });
    const dir = join(h.dir, 'backups');
    const written = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.startsWith('milewage-'))
      : [];
    expect(written).toEqual([]);
  });

  test('recipientOf rejects text that is not an age secret key', async () => {
    await expect(recipientOf('hello')).rejects.toThrow();
    const k = await generateRecoveryKey();
    expect(await recipientOf(k.identity)).toBe(k.recipient);
    expect(ageCodec(k.recipient).suffix).toBe('.db.gz.age');
  });

  // B14: files written by the pinned age-encryption must open with the standard Go `age` tool.
  const ageBin = process.env.AGE_BIN ?? 'age';
  const hasAge = spawnSync(ageBin, ['--version']).status === 0;
  test.skipIf(!hasAge)(
    'the Go age tool decrypts our backup, and we decrypt its files (B14)',
    async () => {
      const { recoveryKey } = await h.signUp();
      const row = (await service().run('manual'))!;
      const keyFile = join(h.dir, 'key.txt');
      writeFileSync(keyFile, `${recoveryKey}\n`, { mode: 0o600 });
      const file = join(h.dir, 'backups', row.fileName);
      const out = spawnSync(ageBin, ['-d', '-i', keyFile, file], { maxBuffer: 256 * 1024 * 1024 });
      expect(out.status, out.stderr.toString()).toBe(0);
      const copy = join(h.dir, 'go-restored.db');
      writeFileSync(copy, gunzipSync(out.stdout));
      const db = new Database(copy, { readonly: true });
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      db.close();
      const recipient = JSON.parse(readFileSync(secretsPath(), 'utf8')).age_public_key as string;
      const enc = spawnSync(ageBin, ['-r', recipient], { input: Buffer.from('hello from go age') });
      const back = await readAll(await decryptStream(Readable.from(enc.stdout), recoveryKey));
      expect(back.toString()).toBe('hello from go age');
    },
  );
});
