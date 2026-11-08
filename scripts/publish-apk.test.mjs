import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('./publish-apk.sh', import.meta.url));
const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
let dir;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'publish-apk-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('copies the app and writes its version and build time next to it', () => {
  const src = join(dir, 'app-release.apk');
  writeFileSync(src, 'PK-new');
  utimesSync(src, 1_800_000_000, 1_800_000_000);
  const dest = join(dir, 'config', 'milewage.apk');
  const r = spawnSync('bash', [script, src, dest], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  expect(readFileSync(dest, 'utf8')).toBe('PK-new');
  expect(JSON.parse(readFileSync(`${dest}.json`, 'utf8'))).toEqual({
    version,
    built_at: '2027-01-15T08:00:00Z',
  });
  expect(existsSync(`${dest}.part`)).toBe(false);
  expect(r.stdout).toContain(`version ${version}`);
});

test('refuses a missing app file and writes nothing', () => {
  const dest = join(dir, 'milewage.apk');
  const r = spawnSync('bash', [script, join(dir, 'nope.apk'), dest], { encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(existsSync(dest)).toBe(false);
});
