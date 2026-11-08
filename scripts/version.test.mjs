import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { APP_CONFIG, appConfigVersion, check, sync } from './version.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));

function fixture(version, pkgVersions) {
  const root = mkdtempSync(join(tmpdir(), 'ver-'));
  writeFileSync(join(root, 'VERSION'), version + '\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root', version }));
  Object.entries(pkgVersions).forEach(([name, v]) => {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name, version: v }),
    );
  });
  return root;
}

test('check passes when all versions match', () => {
  expect(check(fixture('1.2.3', { a: '1.2.3', b: '1.2.3' }))).toEqual([]);
});

test('check fails when a workspace version differs', () => {
  const bad = check(fixture('1.2.3', { a: '1.2.3', b: '1.2.4' }));
  expect(bad).toHaveLength(1);
  expect(bad[0]).toMatchObject({ found: '1.2.4', expected: '1.2.3' });
});

test('check rejects a malformed VERSION', () => {
  expect(() => check(fixture('v1', {}))).toThrow(/semantic version/);
});

test('sync rewrites mismatched files and then check passes', () => {
  const root = fixture('2.0.0', { a: '1.0.0' });
  expect(sync(root)).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(root, 'packages/a/package.json'), 'utf8')).version).toBe(
    '2.0.0',
  );
  expect(check(root)).toEqual([]);
});

// The phone app config reads VERSION itself; check() evaluates it under node with the given env.
function withAppConfig(root, source) {
  mkdirSync(join(root, 'apps', 'phone'), { recursive: true });
  if (source) writeFileSync(join(root, APP_CONFIG), source);
  else copyFileSync(join(repo, APP_CONFIG), join(root, APP_CONFIG));
  return root;
}
const noCode = { ...process.env, MILEWAGE_VERSION_CODE: '' };

test('the real app config resolves to the VERSION of the tree it sits in', () => {
  const root = withAppConfig(fixture('3.4.5', {}));
  expect(appConfigVersion(root, noCode)).toBe('3.4.5');
  expect(check(root, noCode)).toEqual([]);
});

test('check fails when the app config resolves to another version', () => {
  const root = withAppConfig(
    fixture('1.2.3', {}),
    "module.exports = { expo: { version: '1.0.0' } };",
  );
  expect(check(root, noCode)).toEqual([
    { file: join(root, APP_CONFIG), found: '1.0.0', expected: '1.2.3' },
  ]);
});

test('check fails loudly when MILEWAGE_VERSION_CODE is not a whole number', () => {
  const root = withAppConfig(fixture('1.2.3', {}));
  for (const code of ['12a', '1.5', '-3', '0', '2100000001']) {
    const bad = check(root, { ...process.env, MILEWAGE_VERSION_CODE: code });
    expect(bad).toHaveLength(1);
    expect(bad[0].found).toMatch(/MILEWAGE_VERSION_CODE must be a whole number/);
  }
  expect(check(root, { ...process.env, MILEWAGE_VERSION_CODE: '42' })).toEqual([]);
});

test('the repository itself is in sync, app config included', () => {
  expect(check(repo, noCode)).toEqual([]);
});
