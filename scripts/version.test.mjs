import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { check, sync } from './version.mjs';

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
