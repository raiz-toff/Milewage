import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { GRADLE_APP, androidProblems, check, releasedVersionCodes, sync } from './version.mjs';

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

// The Android app reads VERSION itself; check() looks at its Gradle file and the changelog.
function withAndroid(root, gradle, changelog) {
  mkdirSync(join(root, 'apps', 'android', 'app'), { recursive: true });
  if (gradle) writeFileSync(join(root, GRADLE_APP), gradle);
  else copyFileSync(join(repo, GRADLE_APP), join(root, GRADLE_APP));
  if (changelog) writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  return root;
}
const changelog = (released) =>
  `# Changelog\n\n## [Unreleased]\n\nInstall the new app (versionCode 99).\n\n## [0.2.0] - 2026-11-10\n\n${released}\n`;

test('the real Gradle file reads VERSION and its default versionCode passes', () => {
  const root = withAndroid(fixture('3.4.5', {}), null, changelog('(versionCode 2)'));
  expect(androidProblems(root)).toEqual([]);
  expect(check(root)).toEqual([]);
});

test('only released sections count, and the highest versionCode there', () => {
  expect(
    releasedVersionCodes(
      withAndroid(fixture('1.0.0', {}), null, changelog('versionCode 1, then versionCode 2')),
    ),
  ).toEqual([1, 2]);
});

test('a default versionCode below the last released one fails; equal passes', () => {
  const gradle = (code) =>
    `val milewageVersion = providers.fileContents(x.file("../../VERSION"))\n        if (raw.isNullOrEmpty()) return@let ${code}\n        versionName = milewageVersion\n`;
  const root = withAndroid(fixture('1.2.3', {}), gradle(2), changelog('(versionCode 3)'));
  expect(check(root)).toEqual([
    {
      file: join(root, GRADLE_APP),
      found: 'default versionCode 2',
      expected: 'at least 3, the last released versionCode (CHANGELOG.md)',
    },
  ]);
  writeFileSync(join(root, GRADLE_APP), gradle(3));
  expect(check(root)).toEqual([]);
});

test('a versionName that no longer comes from VERSION fails', () => {
  const root = withAndroid(
    fixture('1.2.3', {}),
    'versionName = "1.0"\n        if (raw.isNullOrEmpty()) return@let 3\n',
    changelog(''),
  );
  expect(check(root).map((p) => p.found)).toEqual(['a versionName not read from VERSION']);
});

test('the repository itself is in sync, the Android app included', () => {
  expect(check(repo)).toEqual([]);
  expect(androidProblems(repo)).toEqual([]);
});
