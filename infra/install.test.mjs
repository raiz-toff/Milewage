import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

const script = join(fileURLToPath(new URL('.', import.meta.url)), 'install.sh');
let dir;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'install-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) =>
  spawnSync('bash', [script, '--no-start', '--env-file', join(dir, 'sub', '.env'), ...args], {
    encoding: 'utf8',
  });
const envText = () => readFileSync(join(dir, 'sub', '.env'), 'utf8');

test('writes the .env with the defaults, owner-only, and holds no secret', () => {
  const r = run('--port', '18555');
  expect(r.status).toBe(0);
  expect(envText()).toContain('MILEWAGE_HOST_PORT=18555');
  expect(envText()).toContain('MILEWAGE_PROXY_SUBNET=172.29.88.0/24');
  expect(envText()).toContain('MILEWAGE_PROXY_GATEWAY=172.29.88.1\n');
  expect(envText()).not.toMatch(/KEY|SECRET|PASSWORD|TOKEN/i);
  expect(
    spawnSync('stat', ['-c', '%a', join(dir, 'sub', '.env')], { encoding: 'utf8' }).stdout.trim(),
  ).toBe('600');
});

test('the gateway Caddy trusts is the first address of the chosen subnet', () => {
  expect(run('--subnet', '10.77.5.0/24').status).toBe(0);
  expect(envText()).toContain('MILEWAGE_PROXY_GATEWAY=10.77.5.1\n');
});

test('never overwrites an existing .env', () => {
  expect(run('--port', '18556').status).toBe(0);
  const r = run('--port', '18557');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('Keeping the existing');
  expect(envText()).toContain('MILEWAGE_HOST_PORT=18556');
});

test('takes the next free port when the chosen one is busy', async () => {
  const server = createServer();
  await new Promise((ok) => server.listen(18560, '127.0.0.1', ok));
  try {
    const r = await new Promise((ok) => {
      // spawnSync would block the loop that serves the socket; the connection is accepted by the kernel anyway
      ok(run('--port', '18560'));
    });
    expect(r.status).toBe(0);
    expect(envText()).toContain('MILEWAGE_HOST_PORT=18561');
  } finally {
    server.close();
  }
});

test('refuses a bad port and a bad subnet and writes nothing', () => {
  for (const args of [
    ['--port', 'abc'],
    ['--port', '80'],
    ['--port', '70000'],
    ['--subnet', 'nope'],
  ]) {
    const r = run(...args);
    expect(r.status, args.join(' ')).toBe(2);
    expect(existsSync(join(dir, 'sub', '.env'))).toBe(false);
  }
  expect(run('--bogus').status).toBe(2);
  writeFileSync(join(dir, 'unused'), '');
});
