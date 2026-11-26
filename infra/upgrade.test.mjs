// infra/upgrade.sh with a fake host (infra/fake-host.mjs) and a real git checkout that is one commit behind.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Each run starts a dozen processes; Git Bash on Windows needs seconds for that.
vi.setConfig({ testTimeout: 60_000 });
import { fakeBin, runScript } from './fake-host.mjs';

const infra = fileURLToPath(new URL('.', import.meta.url));
let dir;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'upgrade-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd, ...args) => {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-C', cwd, ...args],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const log = (name) =>
  existsSync(join(dir, `${name}.log`)) ? readFileSync(join(dir, `${name}.log`), 'utf8') : '';

/** A checkout at 0.2.5 whose remote already has 0.3.1, with the scripts and an installed .env. */
function checkout() {
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, work);
  mkdirSync(join(work, 'infra', 'docker'), { recursive: true });
  mkdirSync(join(work, 'infra', 'docs'));
  for (const f of ['upgrade.sh', 'lib.sh']) copyFileSync(join(infra, f), join(work, 'infra', f));
  copyFileSync(join(infra, 'docs', 'upgrade.md'), join(work, 'infra', 'docs', 'upgrade.md'));
  writeFileSync(join(work, 'VERSION'), '0.2.5\n');
  writeFileSync(join(work, 'infra', 'docker', 'docker-compose.yml'), 'name: x\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'one');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(work, 'branch', '-q', '-u', 'origin/main');
  const other = join(dir, 'other');
  git(dir, 'clone', '-q', origin, other);
  writeFileSync(join(other, 'VERSION'), '0.3.1\n');
  git(other, 'commit', '-qam', 'two');
  git(other, 'push', '-q', 'origin', 'HEAD:main');
  writeFileSync(join(work, 'infra', 'docker', '.env'), 'MILEWAGE_HOST_PORT=38080\n');
  return work;
}
const backup = { backup: '/app/backups/milewage-1.db.gz.age' };
const upgrade = (work, host) => {
  const { bin } = fakeBin(dir, host);
  return runScript(join(work, 'infra', 'upgrade.sh'), [], {
    bin,
    env: { MILEWAGE_BACKUP_COPY_DIR: join(dir, 'copies') },
  });
};
const version = (work) => readFileSync(join(work, 'VERSION'), 'utf8').trim();

describe('upgrade.sh', () => {
  test('copies the newest backup out, pulls, rebuilds with --remove-orphans, says the version and the notes', () => {
    const work = checkout();
    const r = upgrade(work, backup);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'copies', 'milewage-1.db.gz.age'), 'utf8')).toBe(
      'encrypted-backup-bytes',
    );
    expect(version(work)).toBe('0.3.1');
    // the backup copy is made before the build
    const calls = log('docker');
    expect(calls.indexOf(' cat /app/backups/')).toBeGreaterThan(-1);
    expect(calls.indexOf(' cat /app/backups/')).toBeLessThan(calls.indexOf('up -d'));
    expect(calls).toMatch(/up -d --build --remove-orphans --wait/);
    expect(r.stdout).toContain('MileWage is now 0.3.1 (was 0.2.5)');
    expect(r.stdout).toContain('"Version notes" for: 0.3.0 0.3.1');
  });

  test('running it again with nothing new changes nothing', () => {
    const work = checkout();
    expect(upgrade(work, backup).status).toBe(0);
    rmSync(join(dir, 'docker.log'));
    const r = upgrade(work, backup);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Already on the newest version (0.3.1)');
    expect(log('docker')).not.toMatch(/up -d|run /);
  });

  test('a dirty tree is refused with the fix, and nothing is touched', () => {
    const work = checkout();
    writeFileSync(join(work, 'infra', 'docs', 'upgrade.md'), 'my edit\n');
    const r = upgrade(work, backup);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('git stash');
    expect(r.stderr).toContain('git checkout -- <file>');
    expect(version(work)).toBe('0.2.5');
    expect(log('docker')).not.toMatch(/up -d/);
    expect(existsSync(join(dir, 'copies'))).toBe(false);
  });

  test('a checkout with its own commits (diverged) is refused with the fix', () => {
    const work = checkout();
    writeFileSync(join(work, 'mine.txt'), 'x\n');
    git(work, 'add', 'mine.txt');
    git(work, 'commit', '-qm', 'mine');
    const r = upgrade(work, backup);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('git reset --hard origin/main');
    expect(version(work)).toBe('0.2.5');
    expect(log('docker')).not.toMatch(/up -d/);
  });

  test('no backup, or a stale one: refused before anything changes, with the next step', () => {
    for (const [host, says] of [
      [{}, 'There is no backup yet'],
      [{ ...backup, backupFresh: false }, 'more than 36 hours old'],
    ]) {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);
      const work = checkout();
      const r = upgrade(work, host);
      expect(r.status, says).toBe(1);
      expect(r.stderr).toContain(says);
      expect(r.stderr).toContain('Back up now');
      expect(version(work)).toBe('0.2.5');
      expect(log('docker')).not.toMatch(/up -d/);
    }
  });

  test('not installed: says to run install.sh', () => {
    const work = checkout();
    rmSync(join(work, 'infra', 'docker', '.env'));
    const r = upgrade(work, backup);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('infra/install.sh');
  });

  test('host problems are named with the next command (Docker not allowed)', () => {
    const work = checkout();
    const r = upgrade(work, { docker: 'permission' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sudo usermod -aG docker');
    expect(version(work)).toBe('0.2.5');
  });

  test('a build that does not become healthy says where to look and where the way back is', () => {
    const work = checkout();
    writeFileSync(join(dir, 'up.fails'), '');
    const r = upgrade(work, backup);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('logs api');
    expect(r.stderr).toContain('Roll back');
  });
});
