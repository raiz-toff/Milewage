// infra/doctor.sh with a fake host (infra/fake-host.mjs): green and red lines, the next step, no secrets.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Each run starts a dozen processes; Git Bash on Windows needs seconds for that.
vi.setConfig({ testTimeout: 60_000 });
import { fakeBin, runScript } from './fake-host.mjs';

const script = fileURLToPath(new URL('./doctor.sh', import.meta.url));
let dir;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'doctor-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const up = 'api running healthy\ncaddy running healthy\n';
const backup = '/app/backups/milewage-1.db.gz.age';
const envFile = () => join(dir, 'sub', '.env');
const SECRET = /s3cret|OWNER_TOKEN/;
function doctor(host, { env = true } = {}) {
  const { bin } = fakeBin(dir, host);
  if (env) {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(
      envFile(),
      'MILEWAGE_HOST_PORT=38080\nMILEWAGE_HOME_URL=http://192.168.1.20:38080\nMILEWAGE_OWNER_TOKEN=s3cret-value\n',
    );
  }
  return runScript(script, ['--env-file', envFile()], { bin });
}

test('everything fine: green lines, exit 0, and no secret in the output', () => {
  const r = doctor({ ps: up, backup });
  expect(r.status, r.stdout + r.stderr).toBe(0);
  for (const line of [
    '[ok]   Docker answers',
    '[ok]   The api container is running',
    '[ok]   The caddy container is running',
    '[ok]   The server answers at http://127.0.0.1:38080/healthz',
    '[ok]   The home network address answers: http://192.168.1.20:38080',
    '[ok]   The clocks agree',
    '[ok]   Disk space',
    '[ok]   The newest backup is under 36 hours old',
    'Everything checked is fine.',
  ])
    expect(r.stdout).toContain(line);
  expect(r.stdout + r.stderr).not.toMatch(SECRET);
});

test('the stack is down: says so, gives the command to start it, exits 1', () => {
  const r = doctor({ ps: '' });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('[FAIL] The api container is not running.');
  expect(r.stdout).toContain('The stack is down. Start it with: docker compose');
  expect(r.stdout).toMatch(/Next step: docker compose .* up -d/);
  expect(r.stdout + r.stderr).not.toMatch(SECRET);
});

test('/healthz not answering: red, with where to look', () => {
  const r = doctor({ ps: up, backup, healthy: false });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('[FAIL] The server does not answer at http://127.0.0.1:38080/healthz');
  expect(r.stdout).toContain('[FAIL] The home network address does not answer');
  expect(r.stdout).toMatch(/Next step: docker compose .* logs api/);
});

test('clocks an hour apart: red, with the command', () => {
  const r = doctor({ ps: up, backup, dateOffsetS: -3600 });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("[FAIL] This host's clock and the server's are");
  expect(r.stdout).toContain('Next step: sudo timedatectl set-ntp true');
});

test('no backup or an old one: red, with the Backups page', () => {
  for (const host of [{ ps: up }, { ps: up, backup, backupFresh: false }]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    const r = doctor(host);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(
      /\[FAIL\] (There is no backup yet|The newest backup is more than 36 hours old)/,
    );
    expect(r.stdout).toContain('Back up now');
  }
});

test('low disk is red', () => {
  const r = doctor({ ps: up, backup, freeKb: 100_000 });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('[FAIL] Only 97 MB of disk are free');
});

test('Tailscale: a public address that nothing serves is red with the exact command', () => {
  const { bin, fake } = fakeBin(dir, { ps: up, backup });
  fake('tailscale', 'case "$1" in serve) echo "No serve config" ;; esac');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(
    envFile(),
    'MILEWAGE_HOST_PORT=38080\nMILEWAGE_PUBLIC_URL=https://box.tail1234.ts.net\n',
  );
  const r = runScript(script, ['--env-file', envFile()], { bin });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('[FAIL] Tailscale is not serving port 38080');
  expect(r.stdout).toContain('tailscale serve --bg 38080');
  expect(r.stdout).toContain('tailscale serve --https=443 off');
});

test('Docker problems and a missing .env give the next command', () => {
  let r = doctor({ docker: 'permission' }, { env: false });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('Docker is running but this user may not use it.');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  r = doctor({}, { env: false });
  expect(r.stdout).toContain('Next step: Run infra/install.sh');
});
