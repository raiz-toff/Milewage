import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runCli } from '../src/cli';
import { verifyPassword } from '../src/auth/password';
import { harness, owner, type Harness } from './support';

// `milewage-cli reset-password`: the way back in when the owner forgets the password.
let h: Harness;

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    { MILEWAGE_DATA_DIR: h.dir },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
};
/** Stops the server as `docker compose stop api` would; the data folder stays. */
const stop = async () => {
  await h.app.close();
  h.db.close();
};

beforeEach(async () => {
  h = harness();
  await h.signUp();
});
afterEach(async () => {
  if (h.db.open) await h.close();
  else rmSync(h.dir, { recursive: true, force: true });
});

test('refuses while the server runs, and changes nothing', async () => {
  const r = await cli('reset-password');
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/stop the api service first/);
});

test('sets a new random password, prints it once and signs out every browser', async () => {
  await stop();
  const r = await cli('reset-password');
  expect(r.code).toBe(0);
  const password = /New password for sam: (\S+)/.exec(r.out)?.[1];
  expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);
  const db = new Database(`${h.dir}/milewage.db`);
  try {
    const hash = db.prepare('SELECT password_hash FROM users').pluck().get() as string;
    expect(await verifyPassword(password!, hash)).toBe(true);
    expect(await verifyPassword(owner.password, hash)).toBe(false);
    expect(db.prepare('SELECT count(*) FROM web_sessions').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM devices').pluck().get()).toBe(0);
  } finally {
    db.close();
  }
});

test('--username picks the account; an unknown one is refused', async () => {
  await stop();
  expect((await cli('reset-password', '--username', 'nobody')).err).toMatch(
    /No account is called nobody/,
  );
  expect((await cli('reset-password', '--username=SAM')).code).toBe(0);
  expect((await cli('reset-password', '--force')).code).toBe(2);
});
