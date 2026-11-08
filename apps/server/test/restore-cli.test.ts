import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli, type CliIo } from '../src/cli';
import { restoreCommand } from '../src/cli-restore';
import {
  buildBackupService,
  generateRecoveryKey,
  NEWER_BACKUP,
  openAndMigrate,
  openDatabase,
  recipientOf,
} from '../src/index';
import { harness, type Harness } from './support';

// `milewage-cli restore` (10 section 7, run with the api stopped): a real encrypted backup of one
// instance is restored into another data folder.
let source: Harness;
let key: string;
let backupFile: string;
let root: string; // holds data/ and config/ of the host being restored
let data: string;
const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(20, 7),
]);

const backupOf = async (h: Harness) => {
  const svc = buildBackupService({
    db: h.db,
    now: () => h.clock.t,
    backupDir: join(h.dir, 'backups'),
    configDir: join(h.dir, 'config'),
  });
  return join(h.dir, 'backups', (await svc.run('manual'))!.fileName);
};

beforeEach(async () => {
  source = harness();
  const { cookie, recoveryKey } = await source.signUp();
  key = recoveryKey;
  await source.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  const { auth } = await source.pair(cookie);
  const t0 = source.clock.t;
  await source.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  const points = [1, 2, 3].map((seq) => ({
    seq,
    recorded_at: t0 + seq * 1000,
    lat_e7: 377749290,
    lon_e7: -1224194160,
    accuracy_m: 5,
  }));
  source.clock.t += 60_000;
  const batch = { shift_client_id: SHIFT, points };
  expect((await source.call('POST', '/telemetry/batch', batch, auth)).statusCode).toBe(200);
  const expense = { spent_on: '2027-01-10', category: 'fuel', amount_cents: 5000 };
  const id = (await source.call('POST', '/expenses', expense, { cookie })).json().id as number;
  const put = await source.app.inject({
    method: 'PUT',
    url: `/api/v1/expenses/${id}/receipt`,
    payload: PNG,
    headers: { 'content-type': 'image/png', cookie, origin: 'http://mw.test', host: 'mw.test' },
  });
  expect(put.statusCode).toBeLessThan(300);
  source.db.prepare('UPDATE instance SET restore_generation = 2 WHERE id = 1').run();
  backupFile = await backupOf(source);

  // The host being restored: its own data at generation 7, a receipt file and a diagnostics file.
  root = mkdtempSync(join(tmpdir(), 'mw-cli-restore-'));
  data = join(root, 'data');
  mkdirSync(join(data, 'receipts'), { recursive: true });
  const live = openAndMigrate(join(data, 'milewage.db'));
  live.exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 1);
    INSERT INTO instance (id, instance_id, restore_generation) VALUES (1, 'old-instance', 7);`);
  live.close();
  writeFileSync(join(data, 'receipts', 'old.png'), 'old receipt');
  writeFileSync(join(data, 'diagnostics.db'), 'diagnostics');
});
afterEach(async () => {
  await source.close();
  rmSync(root, { recursive: true, force: true });
});

const env = () => ({ MILEWAGE_DATA_DIR: data, MILEWAGE_CONFIG_DIR: join(root, 'config') });
const io = (answers: string[] = []) => {
  const out: string[] = [];
  const err: string[] = [];
  const sink: CliIo & { out_: string[]; err_: string[] } = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    out_: out,
    err_: err,
  };
  if (answers.length > 0) sink.ask = async () => answers.shift() ?? '';
  return sink;
};
const restore = async (args: string[], sink = io()) => {
  const code = await runCli(['restore', ...args], env(), sink);
  return { code, out: sink.out_.join('\n'), err: sink.err_.join('\n') };
};
const users = () => {
  const db = new Database(join(data, 'milewage.db'), { readonly: true });
  try {
    return db.prepare('SELECT username FROM users').pluck().all();
  } finally {
    db.close();
  }
};
const asides = () => readdirSync(data).filter((f) => f.startsWith('before-restore-'));

describe('milewage-cli restore', { timeout: 60_000 }, () => {
  test('restores a real backup, moves the old data aside and bumps the generation past both', async () => {
    const r = await restore(['--file', backupFile, '--key', key, '--yes']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const db = new Database(join(data, 'milewage.db'), { readonly: true });
    const sourceId = source.db.prepare('SELECT instance_id FROM instance').pluck().get();
    expect(db.prepare('SELECT instance_id, restore_generation FROM instance').get()).toEqual({
      instance_id: sourceId,
      restore_generation: 8, // max(old 7, restored 2) + 1, as POST /setup/restore does
    });
    const n = (t: string) => db.prepare(`SELECT count(*) FROM ${t}`).pluck().get();
    expect([n('shifts'), n('telemetry_points'), n('expense_receipts')]).toEqual([1, 3, 1]);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'receipt_blobs'").get()).toBe(
      undefined,
    );
    db.close();
    const receipts = readdirSync(join(data, 'receipts'));
    expect(receipts).toHaveLength(1);
    expect(readFileSync(join(data, 'receipts', receipts[0]!)).equals(PNG)).toBe(true);

    // The old data is kept whole, next to the new data on the same volume; diagnostics stay put.
    const [aside] = asides();
    expect(aside).toMatch(/^before-restore-\d{8}T\d{9}Z$/);
    const old = new Database(join(data, aside!, 'milewage.db'), { readonly: true });
    expect(old.prepare('SELECT username FROM users').pluck().all()).toEqual(['old']);
    old.close();
    expect(readFileSync(join(data, aside!, 'receipts', 'old.png'), 'utf8')).toBe('old receipt');
    expect(readFileSync(join(data, 'diagnostics.db'), 'utf8')).toBe('diagnostics');
    expect(existsSync(join(data, '.restore-tmp'))).toBe(false);

    expect(r.out).toContain('1 shifts (');
    expect(r.out).toContain('3 GPS points');
    expect(r.out).toContain('Restore generation is now 8');
    expect(r.out).toContain(`The previous data is in ${join(data, aside!)}`);
    // With no key configured on this host, later backups use the key just given.
    const secrets = JSON.parse(readFileSync(join(root, 'config', 'secrets.json'), 'utf8'));
    expect(secrets.age_public_key).toBe(await recipientOf(key));
    // The server opens the result with nothing left to migrate.
    openAndMigrate(join(data, 'milewage.db')).close();
  });

  test('into an empty data folder, with the key read from a file', async () => {
    rmSync(data, { recursive: true });
    writeFileSync(join(root, 'key.txt'), `${key}\n`);
    const r = await restore([`--file=${backupFile}`, `--key=@${join(root, 'key.txt')}`, '--yes']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Restore generation is now 3'); // max(0, 2) + 1
    expect(r.out).toContain('There was no previous data.');
    expect(asides()).toEqual([]);
  });

  test('refuses while the server holds the database, in this or another process', async () => {
    const server = openDatabase(join(data, 'milewage.db'));
    server.prepare('SELECT 1').get();
    let r = await restore(['--file', backupFile, '--key', key, '--yes']);
    server.close();
    expect(r.code).toBe(1);
    expect(r.err).toContain('stop the api service first');

    const script = `const D = require('better-sqlite3'); const d = new D(process.argv[1]);
      d.pragma('journal_mode = wal'); d.prepare('SELECT 1').get(); console.log('ready'); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', script, join(data, 'milewage.db')], {
      cwd: process.cwd(),
    });
    try {
      await new Promise((ok, fail) => {
        child.stdout.once('data', ok);
        child.once('exit', fail);
      });
      r = await restore(['--file', backupFile, '--key', key, '--yes']);
    } finally {
      child.kill();
    }
    expect(r.code).toBe(1);
    expect(r.err).toContain('stop the api service first');
    expect(users()).toEqual(['old']);
    expect(asides()).toEqual([]);
  });

  test('a wrong key, a damaged or truncated file, a newer backup and a missing file change nothing', async () => {
    const other = (await generateRecoveryKey()).identity;
    const bytes = readFileSync(backupFile);
    const good = join(root, 'good.age'); // the next backup of the same day prunes the original
    writeFileSync(good, bytes);
    const damaged = Buffer.from(bytes);
    damaged[damaged.length - 5]! ^= 0xff;
    writeFileSync(join(root, 'damaged.age'), damaged);
    writeFileSync(join(root, 'truncated.age'), bytes.subarray(0, Math.floor(bytes.length / 2)));
    source.db.prepare("INSERT INTO schema_migrations VALUES ('core', '9999_future', 1)").run();
    source.clock.t += 60_000;
    const newer = await backupOf(source);

    const cases: [string[], RegExp][] = [
      [['--file', good, '--key', other], /recovery key does not open this file/],
      [['--file', join(root, 'damaged.age'), '--key', key], /or the file is damaged/],
      [['--file', join(root, 'truncated.age'), '--key', key], /or the file is damaged/],
      [['--file', newer, '--key', key], new RegExp(NEWER_BACKUP)],
      [['--file', join(root, 'nope.age'), '--key', key], /No backup file at/],
      [['--file', good, '--key', 'not a key'], /not an age recovery key/],
      [['--file', good, '--key', `@${join(root, 'nope.txt')}`], /Cannot read the recovery/],
    ];
    for (const [args, message] of cases) {
      const r = await restore([...args, '--yes']);
      expect([r.code, r.err]).toEqual([1, expect.stringMatching(message)]);
    }
    expect(users()).toEqual(['old']);
    expect(asides()).toEqual([]);
    expect(existsSync(join(data, '.restore-tmp'))).toBe(false);
  });

  test('a restored copy that fails verification puts the previous data back', async () => {
    const sink = io();
    const code = await restoreCommand(
      {
        file: backupFile,
        key,
        yes: true,
        verify: () => {
          throw new Error('forced');
        },
      },
      env(),
      sink,
    );
    expect(code).toBe(1);
    expect(sink.err_.join('\n')).toContain('the previous data was put back');
    expect(users()).toEqual(['old']);
    expect(readFileSync(join(data, 'receipts', 'old.png'), 'utf8')).toBe('old receipt');
    expect(asides()).toEqual([]);
  });

  test('without --yes it asks first; usage errors exit 2', async () => {
    let r = await restore(['--file', backupFile, '--key', key], io(['no']));
    expect([r.code, r.err]).toEqual([1, 'Cancelled. Nothing was changed.']);
    expect(r.out).toContain('The current data is moved to');
    expect(users()).toEqual(['old']);
    r = await restore(['--file', backupFile], io([key, 'yes'])); // the key typed at the prompt
    expect(r.code).toBe(0);

    expect((await restore(['--file', backupFile, '--key', key])).code).toBe(2); // no terminal
    expect((await restore([])).code).toBe(2);
    expect((await restore(['--file'])).code).toBe(2);
    expect((await restore(['--file', backupFile, '--yes'])).err).toContain(
      'needs the recovery key',
    );
    expect((await restore(['--file', backupFile, '--force'])).err).toContain('Unknown option');
    expect((await restore(['--file', backupFile, '--force'])).code).toBe(2);
  });
});
