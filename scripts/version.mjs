#!/usr/bin/env node
// Keeps every package.json version equal to the VERSION file, and checks that the Android app
// (apps/android, which reads VERSION itself) still does and will install over the last release.
// Usage: node scripts/version.mjs check|sync
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function readVersion(root) {
  const v = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  if (!SEMVER.test(v)) throw new Error(`VERSION "${v}" is not a semantic version`);
  return v;
}

export function packageFiles(root) {
  const files = [join(root, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'package.json');
      if (existsSync(file)) files.push(file);
    }
  }
  return files;
}

export const GRADLE_APP = join('apps', 'android', 'app', 'build.gradle.kts');

/** Every `versionCode N` named in the released sections of CHANGELOG.md (not Unreleased). */
export function releasedVersionCodes(root) {
  const file = join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const released = text.slice(Math.max(0, text.search(/^## \[\d/m)));
  return [...released.matchAll(/versionCode (\d+)/g)].map((m) => Number(m[1]));
}

/**
 * The native Android app (apps/android) takes versionName from VERSION itself, so there is nothing
 * to sync. Checked instead: its Gradle file still reads ../../VERSION, and the versionCode it uses
 * without MILEWAGE_VERSION_CODE is not below the last released one (CHANGELOG.md), so a build
 * from this tree installs over every released APK. Returns problems in check()'s shape.
 */
export function androidProblems(root) {
  const file = join(root, GRADLE_APP);
  if (!existsSync(file)) return [];
  const gradle = readFileSync(file, 'utf8');
  const problems = [];
  if (
    !/file\("\.\.\/\.\.\/VERSION"\)/.test(gradle) ||
    !/versionName = milewageVersion\b/.test(gradle)
  )
    problems.push({ file, found: 'a versionName not read from VERSION', expected: 'VERSION' });
  const m = /isNullOrEmpty\(\)\) return@let (\d+)/.exec(gradle);
  const last = Math.max(0, ...releasedVersionCodes(root));
  if (!m) problems.push({ file, found: 'no default versionCode', expected: `at least ${last}` });
  else if (Number(m[1]) < last)
    problems.push({
      file,
      found: `default versionCode ${m[1]}`,
      expected: `at least ${last}, the last released versionCode (CHANGELOG.md)`,
    });
  return problems;
}

/** Returns the package.json files whose version differs from VERSION, and the Android problems. */
export function check(root) {
  const version = readVersion(root);
  const found = packageFiles(root).map((file) => ({
    file,
    found: JSON.parse(readFileSync(file, 'utf8')).version,
  }));
  return [
    ...found.filter((p) => p.found !== version).map((p) => ({ ...p, expected: version })),
    ...androidProblems(root),
  ];
}

/** Rewrites every package.json version to VERSION; returns the files changed. */
export function sync(root) {
  const version = readVersion(root);
  const changed = [];
  for (const file of packageFiles(root)) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.version === version) continue;
    pkg.version = version;
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    changed.push(file);
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mode = process.argv[2];
  if (mode === 'check') {
    const bad = check(root);
    for (const b of bad) console.error(`${b.file}: ${b.found}, expected ${b.expected}`);
    if (bad.length) {
      console.error(
        'package.json versions: run "npm run version:sync". The Android default versionCode: raise it in apps/android/app/build.gradle.kts.',
      );
      process.exit(1);
    }
    console.log(`version ok (${readVersion(root)})`);
  } else if (mode === 'sync') {
    const changed = sync(root);
    console.log(changed.length ? `updated:\n${changed.join('\n')}` : 'already in sync');
  } else {
    console.error('Usage: version.mjs check|sync');
    process.exit(2);
  }
}
