import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { buildServer, lockedVersion } from './build-server.mjs';
import {
  buildBackupService,
  fileSecrets,
  generateRecoveryKey,
  openAndMigrate,
} from '../apps/server/src/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('lockedVersion reads the exact locked version and fails on a missing package', () => {
  const lock = { packages: { 'node_modules/x': { version: '1.2.3' } } };
  expect(lockedVersion(lock, 'x')).toBe('1.2.3');
  expect(() => lockedVersion(lock, 'y')).toThrow(/not in package-lock/);
});

test('the bundle keeps the native module external and pins it', async () => {
  // Under node_modules/.cache, so the bundle finds better-sqlite3 as the image's /app does.
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  const out = mkdtempSync(join(root, 'node_modules', '.cache', 'bundle-'));
  const dir = mkdtempSync(join(tmpdir(), 'bundle-restore-'));
  try {
    const { dependencies } = await buildServer(out);
    const code = readFileSync(join(out, 'server.mjs'), 'utf8');
    expect(code).toMatch(/from ["']better-sqlite3["']/);
    expect(code).not.toMatch(/from ["']fastify["']/);
    expect(dependencies['better-sqlite3']).toMatch(/^\d+\.\d+\.\d+$/);
    const pkg = JSON.parse(readFileSync(join(out, 'native-package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual(dependencies);
    expect(existsSync(join(out, 'migrations', 'core', '0001_identity.sql'))).toBe(true);
    expect(readFileSync(join(out, 'cli.mjs'), 'utf8')).toMatch(/comparison|dry-run/);

    // The bundled `milewage-cli restore` opens a real encrypted backup (10 section 7).
    const db = openAndMigrate(join(dir, 'source.db'));
    db.exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'sam', 'x', 1);
      INSERT INTO instance (id, instance_id, restore_generation) VALUES (1, 'bundle-test', 4);`);
    const key = await generateRecoveryKey();
    fileSecrets(join(dir, 'config')).write({ age_public_key: key.recipient });
    const backup = buildBackupService({
      db,
      now: () => 1_800_000_000_000,
      backupDir: join(dir, 'backups'),
      configDir: join(dir, 'config'),
    });
    const file = join(dir, 'backups', (await backup.run('manual')).fileName);
    db.close();
    const env = {
      ...process.env,
      MILEWAGE_DATA_DIR: join(dir, 'data'),
      MILEWAGE_CONFIG_DIR: join(dir, 'config'),
    };
    const cli = (...args) =>
      spawnSync(process.execPath, [join(out, 'cli.mjs'), ...args], { env, encoding: 'utf8' });
    const run = cli('restore', '--file', file, '--key', key.identity, '--yes');
    expect(run.stderr).toBe('');
    expect(run.stdout).toContain('Restore generation is now 5');
    expect(run.status).toBe(0);
    expect(cli('restore').status).toBe(2);
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
