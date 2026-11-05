#!/usr/bin/env node
// B17 (16 section 9.2, roadmap M8 exit): idle cost of the diagnostics module on the server.
// Starts the built bundle (dist/server.mjs) with the module off and on, alternating, and compares
// idle RSS and CPU. Pass: RSS difference <= 5 MB and CPU difference < 0.1 percentage points.
// Usage: node scripts/measure-b17.mjs [rounds=3] [idleSeconds=20]   (run `npm run build:server` first)
// Linux only (reads /proc). This is a development-machine number, NOT the 1 vCPU / 1 GB VM result.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const bundle = join(root, 'dist', 'server.mjs');
const rounds = Number(process.argv[2] ?? 3);
const idleS = Number(process.argv[3] ?? 20);
const TICKS = 100; // sysconf(_SC_CLK_TCK) on Linux

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const rssMb = (pid) =>
  Number(/VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
const cpuTicks = (pid) => {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return Number(f[11]) + Number(f[12]); // utime + stime
};
const sleep = (ms) => delay(ms);

async function once(diagnostics, port) {
  const dir = mkdtempSync(join(tmpdir(), 'b17-'));
  const env = {
    ...process.env,
    MILEWAGE_PORT: String(port),
    MILEWAGE_HOST: '127.0.0.1',
    MILEWAGE_DATA_DIR: join(dir, 'data'),
    MILEWAGE_BACKUP_DIR: join(dir, 'backups'),
    MILEWAGE_CONFIG_DIR: join(dir, 'config'),
    MILEWAGE_LOG_LEVEL: 'silent',
    MILEWAGE_MODULE_DIAGNOSTICS: diagnostics ? '1' : '0',
  };
  const child = spawn(process.execPath, ['--max-old-space-size=96', bundle], {
    env,
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await globalThis.fetch(`http://127.0.0.1:${port}/healthz`)).ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(100);
    }
    await sleep(3000); // settle: startup allocations and the first GC
    const t0 = cpuTicks(child.pid);
    await sleep(idleS * 1000);
    const cpuPct = ((cpuTicks(child.pid) - t0) / TICKS / idleS) * 100;
    return { rss: rssMb(child.pid), cpuPct };
  } finally {
    child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(bundle)) {
    console.error('dist/server.mjs is missing: run `npm run build:server` first.');
    process.exit(2);
  }
  const runs = { off: [], on: [] };
  for (let i = 0; i < rounds; i++) {
    for (const on of i % 2 ? [true, false] : [false, true]) {
      runs[on ? 'on' : 'off'].push(await once(on, 3900 + i * 2 + (on ? 1 : 0)));
    }
  }
  const m = (k, f) => median(runs[k].map(f));
  const rss = { off: m('off', (r) => r.rss), on: m('on', (r) => r.rss) };
  const cpu = { off: m('off', (r) => r.cpuPct), on: m('on', (r) => r.cpuPct) };
  const dRss = rss.on - rss.off;
  const dCpu = cpu.on - cpu.off;
  console.log(
    JSON.stringify(
      {
        rounds,
        idleSeconds: idleS,
        runs,
        rssMb: rss,
        cpuPct: cpu,
        diffRssMb: dRss,
        diffCpuPct: dCpu,
        pass: dRss <= 5 && dCpu < 0.1,
      },
      null,
      2,
    ),
  );
  process.exit(dRss <= 5 && dCpu < 0.1 ? 0 : 1);
}
