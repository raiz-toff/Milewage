#!/usr/bin/env node
// Keeps every package.json version equal to the VERSION file.
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

/** Returns the list of package.json files whose version differs from VERSION. */
export function check(root) {
  const version = readVersion(root);
  return packageFiles(root)
    .map((file) => ({ file, found: JSON.parse(readFileSync(file, 'utf8')).version }))
    .filter((p) => p.found !== version)
    .map((p) => ({ ...p, expected: version }));
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
    for (const b of bad) console.error(`${b.file}: version ${b.found} != VERSION ${b.expected}`);
    if (bad.length) {
      console.error('Run "npm run version:sync" to fix.');
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
