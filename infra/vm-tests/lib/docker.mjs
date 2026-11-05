// Docker and shell helpers for the VM tests. They drive the shipped compose stack
// (infra/docker/docker-compose.yml) plus the small override next to this file; nothing here
// reaches into the product code. `DRY_RUN=1` prints each command instead of running it.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mb } from './stats.mjs';

export const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PROJECT = process.env.VM_PROJECT || 'mwvm';
export const API = `${PROJECT}-api-1`;
export const CADDY = `${PROJECT}-caddy-1`;
export const PORT = process.env.MILEWAGE_HOST_PORT || '8080';
export const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const FILES = [
  '-f',
  'infra/docker/docker-compose.yml',
  '-f',
  'infra/vm-tests/docker-compose.vm.yml',
];

export const dryRun = () => process.env.DRY_RUN === '1';

/** Runs a command and returns trimmed stdout. */
export function run(cmd, args = [], { env = {}, input, timeout } = {}) {
  if (dryRun()) {
    console.log(`DRY ${cmd} ${args.join(' ')}`);
    return '';
  }
  return execFileSync(cmd, args, {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, MILEWAGE_HOST_PORT: PORT, ...env },
    input,
    timeout,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export const sh = (script, opts) => run('bash', ['-c', script], opts);
export const compose = (args, env) =>
  run('docker', ['compose', '-p', PROJECT, ...FILES, ...args], { env });
export const exec = (args, opts) => run('docker', ['exec', API, ...args], opts);

/** VmRSS and VmHWM (peak) of PID 1 in a container, in MB. */
export function proc(container) {
  const t = run('docker', ['exec', container, 'cat', '/proc/1/status']);
  const get = (k) => Number(t.match(new RegExp(`${k}:\\s+(\\d+)`))[1]);
  return { rss: mb(get('VmRSS')), hwm: mb(get('VmHWM')) };
}

/** RSS and peak of the whole stack (API + Caddy). */
export function stack() {
  const a = proc(API);
  const c = proc(CADDY);
  const sum = (x, y) => Math.round((x + y) * 10) / 10;
  return { api: a, caddy: c, rss: sum(a.rss, c.rss), hwm: sum(a.hwm, c.hwm) };
}

/** Sum of the CPU percentages `docker stats` reports for both containers. */
export const cpuPercent = () =>
  run('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}', API, CADDY])
    .split('\n')
    .reduce((s, l) => s + parseFloat(l.split(' ')[1]), 0);

export const writeBytes = (container = API) =>
  Number(
    run('docker', ['exec', container, 'cat', '/proc/1/io']).match(/^write_bytes:\s+(\d+)/m)[1],
  );

/**
 * Read-only SQL against milewage.db from inside the API container. A read-only connection does
 * not disturb the single write connection (10 section 3.1). Returns the rows as objects.
 */
export function query(sql, params = []) {
  const script =
    "const D=require('better-sqlite3');const d=new D('/app/data/milewage.db',{readonly:true});" +
    'const q=JSON.parse(process.env.Q);console.log(JSON.stringify(d.prepare(q.sql).all(...q.params)))';
  const q = JSON.stringify({ sql, params });
  return JSON.parse(run('docker', ['exec', '-e', `Q=${q}`, API, 'node', '-e', script]) || '[]');
}

/** Full integrity and foreign-key check of the live database, read-only. */
export function integrity() {
  const script =
    "const D=require('better-sqlite3');const d=new D('/app/data/milewage.db',{readonly:true});" +
    "console.log(JSON.stringify({integrity:d.pragma('integrity_check',{simple:true}),fk:d.pragma('foreign_key_check').length}))";
  return JSON.parse(exec(['node', '-e', script]) || '{}');
}

export const counts = () => {
  const [row] = query(
    'SELECT (SELECT count(*) FROM shifts) AS shifts, (SELECT count(*) FROM telemetry_points) AS points, ' +
      '(SELECT count(*) FROM schema_migrations) AS migrations',
  );
  return row ?? { shifts: 0, points: 0, migrations: 0 };
};

export async function healthy(seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
