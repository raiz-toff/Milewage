import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildServer, lockedVersion } from './build-server.mjs';

test('lockedVersion reads the exact locked version and fails on a missing package', () => {
  const lock = { packages: { 'node_modules/x': { version: '1.2.3' } } };
  expect(lockedVersion(lock, 'x')).toBe('1.2.3');
  expect(() => lockedVersion(lock, 'y')).toThrow(/not in package-lock/);
});

test('the bundle keeps the native module external and pins it', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bundle-'));
  const { dependencies } = await buildServer(out);
  const code = readFileSync(join(out, 'server.mjs'), 'utf8');
  expect(code).toMatch(/from ["']better-sqlite3["']/);
  expect(code).not.toMatch(/from ["']fastify["']/);
  expect(dependencies['better-sqlite3']).toMatch(/^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync(join(out, 'native-package.json'), 'utf8'));
  expect(pkg.dependencies).toEqual(dependencies);
  expect(existsSync(join(out, 'migrations', 'core', '0001_identity.sql'))).toBe(true);
  expect(readFileSync(join(out, 'cli.mjs'), 'utf8')).toMatch(/comparison|dry-run/);
}, 30_000);
