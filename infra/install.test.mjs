import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect, test } from 'vitest';

const script = join(fileURLToPath(new URL('.', import.meta.url)), 'install.sh');
let dir;
/** The port the fake-host tests ask for; chosen once so nothing else on the machine holds it. */
let hostPort;
beforeAll(async () => void (hostPort = await freePort()));
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'install-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) =>
  spawnSync('bash', [script, '--no-start', '--env-file', join(dir, 'sub', '.env'), ...args], {
    encoding: 'utf8',
  });
const envText = () => readFileSync(join(dir, 'sub', '.env'), 'utf8');

/**
 * A loopback port nothing listens on right now, so a parallel test file (the in-process server of
 * the VM tests, for one) cannot make the script bump the port and fail an exact-port assertion.
 * `next` also checks that `port + 1` is free, for the busy-port test.
 */
const freePort = async ({ next = false } = {}) => {
  for (;;) {
    const port = await new Promise((ok) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => ok(port));
      });
    });
    if (!next) return port;
    const nextFree = await new Promise((ok) => {
      const s = createServer();
      s.once('error', () => ok(false));
      s.listen(port + 1, '127.0.0.1', () => s.close(() => ok(true)));
    });
    if (nextFree) return port;
  }
};

test('writes the .env with the defaults, owner-only, and holds no secret', async () => {
  const port = await freePort();
  const r = run('--port', String(port));
  expect(r.status).toBe(0);
  expect(envText()).toContain(`MILEWAGE_HOST_PORT=${port}`);
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

test('never overwrites an existing .env', async () => {
  const first = await freePort();
  expect(run('--port', String(first)).status).toBe(0);
  const r = run('--port', String(await freePort()));
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('Keeping the existing');
  expect(envText()).toContain(`MILEWAGE_HOST_PORT=${first}`);
});

test('takes the next free port when the chosen one is busy', async () => {
  const port = await freePort({ next: true });
  const server = createServer();
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  try {
    const r = await new Promise((ok) => {
      // spawnSync would block the loop that serves the socket; the connection is accepted by the kernel anyway
      ok(run('--port', String(port)));
    });
    expect(r.status).toBe(0);
    expect(envText()).toContain(`MILEWAGE_HOST_PORT=${port + 1}`);
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

/**
 * The Tailscale step (plan 19 section 3.4) with fake `docker`, `curl` and `tailscale`, on a PATH
 * that holds only the tools the script needs, so the host's own Tailscale is never touched.
 */
function fakeHost({ tailscale = null, serveFails = false } = {}) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of ['sed', 'grep', 'head', 'seq', 'sleep', 'mkdir', 'cat', 'dirname']) {
    const real = spawnSync('bash', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim();
    symlinkSync(real, join(bin, tool));
  }
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "$*" >>"${dir}/${name}.log"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake('docker', 'exit 0');
  fake('curl', 'exit 0');
  if (tailscale !== null) {
    writeFileSync(join(dir, 'status.json'), JSON.stringify(tailscale, null, 2));
    fake(
      'tailscale',
      `case "$1" in status) cat "${dir}/status.json" ;; serve) ${serveFails ? 'echo denied; exit 1' : 'exit 0'} ;; esac`,
    );
  }
  return (args = [], input = '') =>
    spawnSync(
      '/bin/bash',
      [script, '--env-file', join(dir, 'sub', '.env'), '--port', String(hostPort), ...args],
      {
        encoding: 'utf8',
        input,
        env: { PATH: bin, MILEWAGE_INSTALL_RETRY_S: '0' },
      },
    );
}
const log = (name) =>
  existsSync(join(dir, `${name}.log`)) ? readFileSync(join(dir, `${name}.log`), 'utf8') : '';
const signedIn = (over = {}) => ({
  BackendState: 'Running',
  Self: { HostName: 'box', DNSName: 'box.tail1234.ts.net.' },
  CertDomains: ['box.tail1234.ts.net'],
  ...over,
});

test('Tailscale missing: says where to get it, changes nothing, exits 0', () => {
  const r = fakeHost()();
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain('https://tailscale.com/download');
  expect(envText()).not.toContain('MILEWAGE_PUBLIC_URL');
});

test('asks after the privacy note; yes serves the port and writes the address, then checks it', () => {
  const r = fakeHost({ tailscale: signedIn() })([], 'y\n');
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(
    /Privacy note[\s\S]*box\.tail1234\.ts\.net[\s\S]*Turn on https for box\.tail1234\.ts\.net\? \[y\/N\]/,
  );
  expect(log('tailscale')).toContain(`serve --bg ${hostPort}`);
  expect(log('tailscale')).not.toContain('funnel');
  expect(envText()).toContain('MILEWAGE_PUBLIC_URL=https://box.tail1234.ts.net\n');
  expect(log('docker')).toMatch(/up -d --wait --wait-timeout 120 api/);
  expect(log('curl')).toContain('https://box.tail1234.ts.net/healthz');
  expect(r.stdout).toContain('Open https://box.tail1234.ts.net in your browser');
});

test('no, --no-tailscale, not signed in, or certificates off: nothing is served or written', () => {
  const cases = [
    [{ tailscale: signedIn() }, [], 'n\n', 'Skipped'],
    [{ tailscale: signedIn() }, ['--no-tailscale'], '', `tailscale serve --bg ${hostPort}`],
    [{ tailscale: signedIn({ BackendState: 'NeedsLogin' }) }, [], 'y\n', 'sudo tailscale up'],
    [{ tailscale: signedIn({ CertDomains: undefined }) }, [], 'y\n', 'HTTPS Certificates'],
  ];
  for (const [host, args, input, says] of cases) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    const r = fakeHost(host)(args, input);
    expect(r.status, says).toBe(0);
    expect(r.stdout, says).toContain(says);
    expect(log('tailscale'), says).not.toContain('serve');
    expect(envText(), says).not.toContain('MILEWAGE_PUBLIC_URL');
  }
});

test('--yes-tailscale answers for the driver; a failing serve exits 1 with the command to run', () => {
  expect(fakeHost({ tailscale: signedIn() })(['--yes-tailscale']).status).toBe(0);
  expect(envText()).toContain('MILEWAGE_PUBLIC_URL=https://box.tail1234.ts.net');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const r = fakeHost({ tailscale: signedIn(), serveFails: true })(['--yes-tailscale']);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(`sudo tailscale serve --bg ${hostPort}`);
  expect(envText()).not.toContain('MILEWAGE_PUBLIC_URL');
});

test('--lan: Caddy on the LAN, the home address, and the announcer; --no-lan turns it off', () => {
  const lan = (...args) =>
    spawnSync('bash', [script, '--no-start', '--env-file', join(dir, 'sub', '.env'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, MILEWAGE_LAN_IP: '192.168.1.20' },
    });
  const r = lan('--port', '18570', '--lan');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('http://192.168.1.20:18570');
  expect(envText()).toContain('MILEWAGE_BIND_ADDRESS=0.0.0.0\n');
  expect(envText()).toContain('MILEWAGE_HOME_URL=http://192.168.1.20:18570\n');
  expect(envText()).toContain('COMPOSE_PROFILES=lan\n');
  // Run again on the kept .env: the lines are replaced, not added twice.
  expect(lan('--no-lan').status).toBe(0);
  expect(envText()).toContain('MILEWAGE_BIND_ADDRESS=127.0.0.1\n');
  expect(envText()).toContain('MILEWAGE_HOME_URL=\n');
  expect(envText()).toContain('COMPOSE_PROFILES=\n');
  expect(envText().match(/MILEWAGE_BIND_ADDRESS=/g)).toHaveLength(1);
});

test('--lan without a private address of this host leaves LAN access off', () => {
  const r = spawnSync(
    'bash',
    [script, '--no-start', '--env-file', join(dir, 'sub', '.env'), '--lan'],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', MILEWAGE_LAN_IP: '8.8.8.8' } },
  );
  expect(r.status).toBe(0);
  expect(r.stderr).toContain('LAN access stays off');
  expect(envText()).not.toContain('MILEWAGE_BIND_ADDRESS');
});

test('without --lan and without a terminal nothing about the LAN is written', () => {
  expect(run().status).toBe(0);
  expect(envText()).not.toMatch(/MILEWAGE_BIND_ADDRESS|MILEWAGE_HOME_URL|COMPOSE_PROFILES/);
});
