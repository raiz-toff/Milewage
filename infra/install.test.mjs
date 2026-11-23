import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { fakeBin } from './fake-host.mjs';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Each run starts a dozen processes; Git Bash on Windows needs seconds for that.
vi.setConfig({ testTimeout: 60_000 });

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
 * The start-up path with a fake host (infra/fake-host.mjs): fake docker, curl, uname, df and tailscale on a
 * PATH that holds only the tools the script needs, so the host's own Docker and Tailscale are never touched.
 */
function fakeHost({ tailscale = null, serveFails = false, ...host } = {}) {
  const { bin, fake } = fakeBin(dir, host);
  if (tailscale !== null) {
    writeFileSync(join(dir, 'status.json'), JSON.stringify(tailscale, null, 2));
    fake(
      'tailscale',
      `case "$1" in status) cat "${dir}/status.json" ;; serve) ${serveFails ? 'echo denied; exit 1' : 'exit 0'} ;; esac`,
    );
  }
  return (args = [], input = '', env = {}) =>
    spawnSync(
      'bash',
      [script, '--env-file', join(dir, 'sub', '.env'), '--port', String(hostPort), ...args],
      {
        encoding: 'utf8',
        input,
        env: { PATH: bin, MILEWAGE_INSTALL_RETRY_S: '0', ...env },
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

test('--lan: Caddy on the LAN and the home address; --no-lan turns it off', () => {
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
  expect(envText()).not.toContain('COMPOSE_PROFILES');
  // Run again on the kept .env: the lines are replaced, not added twice.
  expect(lan('--no-lan').status).toBe(0);
  expect(envText()).toContain('MILEWAGE_BIND_ADDRESS=127.0.0.1\n');
  expect(envText()).toContain('MILEWAGE_HOME_URL=\n');
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
  expect(envText()).not.toMatch(/MILEWAGE_BIND_ADDRESS|MILEWAGE_HOME_URL/);
});

// Host checks (B2): each failure says the next command to run and nothing is written.
describe('preflight', () => {
  const cases = [
    ['macOS', { os: 'Darwin' }, 'macOS is not supported'],
    ['Git Bash', { os: 'MINGW64_NT-10.0' }, 'wsl --install'],
    ['WSL 1', { kernel: '4.4.0-19041-Microsoft' }, 'wsl --set-version'],
    ['a 32-bit CPU', { arch: 'armv7l' }, '64-bit version of Raspberry Pi OS'],
    ['no Docker', { docker: 'missing' }, 'https://docs.docker.com/engine/install/'],
    ['Docker, not allowed', { docker: 'permission' }, 'sudo usermod -aG docker'],
    ['Docker, not running', { docker: 'down' }, 'sudo systemctl start docker'],
    ['no compose v2', { compose: false }, 'sudo apt-get install docker-compose-plugin'],
    // Git Bash on Windows has its own curl on the PATH, so the stub cannot hide it there.
    ...(process.platform === 'win32'
      ? []
      : [['no curl', { curl: false }, 'sudo apt-get install curl']]),
    ['little disk', { freeKb: 1_000_000 }, 'docker system df'],
  ];
  test.each(cases)('%s: stops with the next step and writes nothing', (_name, host, says) => {
    const r = fakeHost(host)();
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toContain(says);
    expect(existsSync(join(dir, 'sub', '.env'))).toBe(false);
    expect(log('docker')).not.toMatch(/up -d/);
  });

  test('little memory only warns; WSL2 is accepted', () => {
    const meminfo = join(dir, 'meminfo');
    writeFileSync(meminfo, 'MemTotal:         524288 kB\nMemFree: 1 kB\n');
    const r = fakeHost({ kernel: '5.15.153.1-microsoft-standard-WSL2' })(['--no-tailscale'], '', {
      MILEWAGE_MEMINFO: meminfo,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('only 512 MB of memory');
    expect(existsSync(join(dir, 'sub', '.env'))).toBe(true);
  });

  test('--no-start checks nothing about the host (it only writes the file)', () => {
    const { bin } = fakeBin(dir, { os: 'Darwin', docker: 'missing' });
    const r = spawnSync(
      'bash',
      [script, '--no-start', '--env-file', join(dir, 'sub', '.env'), '--port', String(hostPort)],
      { encoding: 'utf8', env: { PATH: bin } },
    );
    expect(r.status, r.stderr).toBe(0);
  });
});

test('the happy path ends with the address to open on the computer, not 127.0.0.1', () => {
  const r = fakeHost()(['--lan', '--no-tailscale'], '', { MILEWAGE_LAN_IP: '192.168.1.20' });
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain(
    `Open this address in a browser on your computer:\n    http://192.168.1.20:${hostPort}`,
  );
  expect(r.stdout).toContain('open MileWage at this same address');
  expect(r.stdout).not.toMatch(/running at http:\/\/127\.0\.0\.1/);
  expect(log('docker')).toMatch(/up -d --build --remove-orphans --wait/);
});

test('loopback only: says the address is for this computer and how to reach it from a phone', () => {
  const r = fakeHost()(['--no-lan', '--no-tailscale']);
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain(`http://localhost:${hostPort}`);
  expect(r.stdout).toContain('infra/install.sh --lan');
});

test('Tailscale steps are printed as exact commands, never "run this script again"', () => {
  for (const host of [
    {},
    { tailscale: signedIn({ BackendState: 'NeedsLogin' }) },
    { tailscale: signedIn({ CertDomains: undefined }) },
  ]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    const r = fakeHost(host)(['--lan'], '', { MILEWAGE_LAN_IP: '192.168.1.20' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`tailscale serve --bg ${hostPort}`);
    expect(r.stdout).not.toMatch(/run this script again/i);
  }
});

test('a serve that fails says what to do when port 443 is taken, with the undo', () => {
  const r = fakeHost({ tailscale: signedIn(), serveFails: true })(['--yes-tailscale']);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('port 443 is already in use');
  expect(r.stderr).toContain('tailscale serve --https=443 off');
});

// The home address (B3): skips Docker and VPN interfaces; no `sed -i`, `grep -P` or required `ip`.
describe('the host address', () => {
  const lanIp = (ipBody, hostnameBody = null, env = {}) => {
    const { bin, fake } = fakeBin(dir);
    if (ipBody !== null) fake('ip', ipBody);
    if (hostnameBody !== null) fake('hostname', hostnameBody);
    return spawnSync('bash', ['-c', `. "${join(script, '..', 'lib.sh')}"; mw_lan_ip`], {
      encoding: 'utf8',
      env: { PATH: bin, ...env },
    }).stdout.trim();
  };
  const route = (src, dev) => `echo "1.1.1.1 via 10.0.0.1 dev ${dev} src ${src} uid 1000"`;
  const addrs = `printf '2: eth0    inet 192.168.1.20/24 brd 192.168.1.255 scope global eth0\n3: docker0    inet 172.17.0.1/16 scope global docker0\n'`;

  test('the source of the default route', () => {
    expect(lanIp(`case "$*" in *route*) ${route('192.168.1.7', 'eth0')} ;; esac`)).toBe(
      '192.168.1.7',
    );
  });
  test('not Docker, and not a VPN: the next usable interface', () => {
    const ip = (src, dev) => `case "$*" in *route*) ${route(src, dev)} ;; *addr*) ${addrs} ;; esac`;
    expect(lanIp(ip('172.17.0.1', 'docker0'))).toBe('192.168.1.20');
    expect(lanIp(ip('10.8.0.2', 'tun0'))).toBe('192.168.1.20');
    expect(lanIp(ip('10.9.0.2', 'tailscale0'))).toBe('192.168.1.20');
  });
  test('without `ip`: hostname -I, skipping Docker', () => {
    expect(lanIp(null, 'echo "172.17.0.1 192.168.5.9"')).toBe('192.168.5.9');
  });
  test('MILEWAGE_LAN_IP wins, if private', () => {
    expect(lanIp(null, null, { MILEWAGE_LAN_IP: '10.1.2.3' })).toBe('10.1.2.3');
    expect(lanIp(null, null, { MILEWAGE_LAN_IP: '8.8.8.8' })).toBe('');
  });
});
