// VM test runner: Spike B B1-B17 against the PRODUCT server (roadmap 17 M3.6; thresholds from
// 10 section 15, 12 section 5 and the M2/M3 exit tables of 17). One function per test:
//   node infra/vm-tests/run.mjs list | <b01|...|b17> [phase]
// Each test prints the measured value, the threshold and PASS/FAIL, writes raw JSON to
// infra/vm-tests/artifacts/ and exits 1 on any FAIL (2 on a test error). Run it on the 1 vCPU / 1 GB
// Proxmox VM next to the compose stack (see README.md); `DRY_RUN=1` only prints the docker commands.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { call, ensureSession, pairDevices } from './lib/api.mjs';
import {
  API,
  BASE,
  REPO,
  compose,
  counts,
  cpuPercent,
  exec,
  healthy,
  integrity,
  query,
  run,
  sh,
  stack,
  writeBytes,
  proc,
} from './lib/docker.mjs';
import { devicesFor, resendUnacked, runLoad } from './lib/loadgen.mjs';
import { avg } from './lib/stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ART = path.join(HERE, 'artifacts');
const STATE = path.join(ART, 'session.json');
const GAP_BETWEEN_BACKUPS_MS = 15 * 60_000 + 5_000; // POST /backups: 1 per 15 minutes (08 section 7.4)
const minutes = (name, fallback) => Number(process.env[name] || fallback);

// ---- reporting ----
export function makeReport(test) {
  const results = [];
  return {
    results,
    check(name, measured, threshold, ok, note = '') {
      results.push({
        name,
        measured,
        threshold,
        verdict: ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL',
        note,
      });
    },
    finish(raw) {
      fs.mkdirSync(ART, { recursive: true });
      const file = path.join(ART, `${test}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({ test, at: new Date().toISOString(), base: BASE, results, raw }, null, 1),
      );
      console.log(`\n== ${test} ==`);
      for (const r of results) {
        const note = r.note ? `  (${r.note})` : '';
        console.log(
          `${r.verdict.padEnd(4)}  ${r.name}: measured ${JSON.stringify(r.measured)}  threshold ${r.threshold}${note}`,
        );
      }
      console.log(`raw: ${path.relative(REPO, file)}`);
      return results.some((r) => r.verdict === 'FAIL') ? 1 : 0;
    },
  };
}

// ---- shared steps ----
fs.mkdirSync(ART, { recursive: true });
const session = () => ensureSession(BASE, STATE);
const restartApi = async () => {
  compose(['restart', 'api']);
  if (!(await healthy(120))) throw new Error('api did not come back');
};
async function sampleWhile(promise, everyMs, fn) {
  const samples = [];
  let done = false;
  promise.finally(() => (done = true));
  while (!done) {
    samples.push(fn());
    await sleep(everyMs);
  }
  return samples;
}
const nonOk = (j) =>
  Object.entries(j.byStatus || {})
    .filter(([k]) => k !== '200')
    .reduce((s, [, v]) => s + v, 0) + (j.netErrors || 0);

/** Waits until POST /backups is allowed again (one manual backup per 15 minutes). */
async function backupSlot(s) {
  const list = await call(BASE, '/api/v1/backups', { cookie: s.cookie });
  const last = (list.json ?? []).find((b) => b.trigger === 'manual' || b.trigger === 'shift_end');
  if (!last) return;
  const serverNow = Number(list.headers.get('x-server-time'));
  const wait = last.created_at + GAP_BETWEEN_BACKUPS_MS - serverNow;
  if (wait > 0) {
    console.log(`waiting ${Math.ceil(wait / 1000)} s for the 15-minute backup limit...`);
    await sleep(wait);
  }
}

/** POST /backups with node:http so no default fetch timeout hides a long backup. */
function postBackup(s, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const u = new URL(`${BASE}/api/v1/backups`);
    const req = http.request(
      u,
      {
        method: 'POST',
        headers: { cookie: s.cookie, origin: u.origin, 'content-length': 0 },
        timeout: timeoutMs,
      },
      (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            json: text ? JSON.parse(text) : null,
            ms: Date.now() - t0,
          }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, timedOut: true, ms: Date.now() - t0 });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ms: Date.now() - t0 }));
    req.end();
  });
}

/** Newest tiered backup on the volume (POST /backups does not return a file name). */
const newestBackup = () => path.basename(exec(['sh', '-c', 'ls -t /app/backups/*.age | head -1']));

const load = async (s, o) => {
  const devices = await pairDevices(BASE, s.cookie, devicesFor(o.rate), o.prefix ?? 'load');
  return {
    devices,
    promise: runLoad({ base: BASE, shiftClientId: s.shift.client_id, devices, ...o }),
  };
};

async function idleRun(mins) {
  await restartApi();
  await sleep(15_000);
  const samples = [];
  const cpu = [];
  for (let i = 0; i < mins * 2; i++) {
    samples.push(stack());
    if (i % 4 === 0) cpu.push(cpuPercent());
    await sleep(30_000);
  }
  return { samples, cpu, peak: Math.max(...samples.map((x) => x.rss)), avgCpu: avg(cpu) };
}

async function backupUnderLoad(s, { secondWriter, loadSeconds, backupAtS, cap }) {
  await backupSlot(s); // wait first: the load must not run while the 15-minute limit is being waited out
  await restartApi();
  const lg = await load(s, { rate: 50, batch: 200, duration: loadSeconds }); // pairs, then starts sending
  if (secondWriter) {
    // Started after pairing: a second writer makes other writes fail with "database is locked".
    exec(['rm', '-f', '/tmp/b15.stop']);
    const noise =
      "const D=require('better-sqlite3');const fs=require('fs');const d=new D('/app/data/milewage.db');" +
      "d.pragma('journal_mode=WAL');d.pragma('busy_timeout=5000');d.exec('CREATE TABLE IF NOT EXISTS b15_noise(t INTEGER)');" +
      "const i=d.prepare('INSERT INTO b15_noise VALUES (?)');const t=setInterval(()=>{if(fs.existsSync('/tmp/b15.stop')){clearInterval(t);d.close();process.exit(0)}try{i.run(Date.now())}catch(e){}},20)";
    run('docker', ['exec', '-d', API, 'node', '-e', noise]);
  }
  try {
    await sleep(backupAtS * 1000);
    const bk = await postBackup(s, cap);
    const j = await lg.promise;
    return { bk, j, apiHwm: proc(API).hwm };
  } finally {
    if (secondWriter) exec(['touch', '/tmp/b15.stop']);
  }
}

/** Runs of consecutive seq per phone that are present in the database (B7 compares journal ranges to them). */
export const ISLANDS_SQL =
  'SELECT device_id, min(seq) AS lo, max(seq) AS hi FROM (SELECT device_id, seq, seq - row_number() OVER (PARTITION BY device_id ORDER BY seq) AS grp FROM telemetry_points WHERE seq < 1000000000) GROUP BY device_id, grp';

// ---- the tests ----
export const TESTS = {
  b01: {
    title: 'Idle footprint, 30 min',
    spec: '10 s15 B1; 17 M2 exit',
    async run(r) {
      const { samples, cpu, peak, avgCpu } = await idleRun(minutes('B1_MINUTES', 30));
      r.check(
        'stack RSS (api+caddy), max over idle run',
        peak,
        '<= 100 MB',
        peak <= 100,
        `api ${samples.at(-1).api.rss} MB + caddy ${samples.at(-1).caddy.rss} MB`,
      );
      r.check('stack CPU average', Math.round(avgCpu * 100) / 100, '< 0.5 %', avgCpu < 0.5);
      const ts = sh('ps -C tailscaled -o rss= | head -1');
      r.check(
        'host tailscaled RSS (reported separately, 10 s14)',
        ts ? `${Math.round(Number(ts) / 1024)} MB` : 'not running',
        'report only',
        null,
      );
      return { samples, cpu };
    },
  },

  b02: {
    title: 'Realistic load, 8 h time-scaled 60x',
    spec: '10 s15 B2; 17 M2 exit',
    async run(r) {
      await restartApi();
      const s = await session();
      const mins = minutes('B2_MINUTES', 8);
      const w0 = writeBytes();
      // One driver: a 20-point batch every second stands for 60 s of 3-second fixes (60x). Two phones
      // alternate so neither exceeds its own limit of 60 batches a minute.
      const devices = await pairDevices(BASE, s.cookie, 2, 'b02');
      const lg = runLoad({
        base: BASE,
        shiftClientId: s.shift.client_id,
        devices,
        rate: 1,
        batch: 20,
        duration: mins * 60,
        seriesFile: path.join(ART, 'b02-series.csv'),
      });
      const rss = await sampleWhile(lg, 10_000, () => stack().rss);
      const j = await lg;
      const w1 = writeBytes();
      const n = Math.max(1, Math.floor(rss.length / 10));
      const growth = ((avg(rss.slice(-n)) - avg(rss.slice(0, n))) / avg(rss.slice(0, n))) * 100;
      r.check('non-200 responses + network errors', nonOk(j), '0', nonOk(j) === 0);
      r.check(
        'RSS growth, last 10% vs first 10% of run',
        Math.round(growth * 10) / 10,
        '<= 10 %',
        growth <= 10,
      );
      r.check(
        'bytes written per simulated driving hour (B11)',
        Math.round((w1 - w0) / mins),
        'report only',
        null,
      );
      return { loadgen: { ...j, state: undefined }, rss };
    },
  },

  b03: {
    title: 'Stress ingestion, 50 req/s x 200 points',
    spec: '10 s15 B3; 17 M2 exit',
    async run(r, withReader = false) {
      await restartApi();
      const s = await session();
      const dur = minutes(withReader ? 'B4_SECONDS' : 'B3_SECONDS', withReader ? 300 : 600);
      const lg = await load(s, {
        rate: 50,
        batch: 200,
        duration: dur,
        seriesFile: path.join(ART, `${withReader ? 'b04' : 'b03'}-series.csv`),
        ...(withReader ? { reader: { cookie: s.cookie, shiftId: s.shift.id } } : {}),
      });
      const hwm = await sampleWhile(lg.promise, 5_000, () => stack().hwm);
      const j = await lg.promise;
      r.check(
        'write p99 latency per batch',
        j.latency_ms.p99,
        '< 100 ms',
        j.latency_ms.p99 < 100,
        `p50 ${j.latency_ms.p50}, p95 ${j.latency_ms.p95}, max ${j.latency_ms.max}, ${j.devices} phones`,
      );
      r.check('SQLITE_BUSY seen by the client', j.busy, '0', j.busy === 0);
      r.check(
        'non-200 responses + network errors (429 would mean the per-phone limit was hit)',
        nonOk(j),
        '0',
        nonOk(j) === 0,
        JSON.stringify(j.byStatus),
      );
      r.check(
        'stack peak RSS (VmHWM api + caddy since restart)',
        Math.max(...hwm),
        '<= 150 MB',
        Math.max(...hwm) <= 150,
      );
      if (withReader) {
        r.check(
          'reader p95 during writes (GET /shifts/{id} and GET /shifts?limit=200 once a second)',
          j.reader.p95_ms,
          '< 200 ms',
          j.reader.p95_ms < 200,
          `${j.reader.count} reads, max ${j.reader.max_ms}; the route-history read of 08 does not exist yet (replay module)`,
        );
      }
      r.check(
        'loadgen CPU seconds (shares the VM vCPU; subtract when judging server CPU)',
        j.loadgen_cpu_s,
        'report only',
        null,
      );
      return { loadgen: { ...j, state: undefined } };
    },
  },

  b04: {
    title: 'Reader during writes',
    spec: '10 s15 B4; 17 M2 exit',
    run: (r) => TESTS.b03.run(r, true),
  },

  b05: {
    title: 'Backup under B3 load',
    spec: '10 s15 B5; 17 M3 exit',
    async run(r) {
      const s = await session();
      const secs = minutes('B5_SECONDS', 240);
      const { bk, j, apiHwm } = await backupUnderLoad(s, {
        secondWriter: false,
        loadSeconds: secs,
        backupAtS: Math.min(90, Math.floor(secs / 3)),
        cap: 1_800_000,
      });
      r.check(
        'backup completed (POST /backups answered 201 with integrity_ok)',
        bk.status,
        '201',
        bk.status === 201 && bk.json?.integrity_ok === true,
        bk.json ? `${bk.ms} ms, ${bk.json.size_bytes} B` : JSON.stringify(bk),
      );
      r.check(
        'max write latency during the whole run (a stall > 1 s fails)',
        j.latency_ms.max,
        '<= 1000 ms',
        j.latency_ms.max <= 1000,
        `max gap between successes ${j.max_gap_between_successes_ms} ms`,
      );
      r.check(
        'non-200 responses + network errors',
        nonOk(j),
        '0',
        nonOk(j) === 0,
        JSON.stringify(j.byStatus),
      );
      r.check(
        'api peak RSS after restart (VmHWM, includes the backup)',
        apiHwm,
        '<= 120 MB (10 s14)',
        apiHwm <= 120,
      );
      return { backup: bk, loadgen: { ...j, state: undefined } };
    },
  },

  b15: {
    title: 'B5b: second writing connection during a backup',
    spec: '10 s15 B5b; 12 S0; 17 M3 exit',
    async run(r) {
      const s = await session();
      const cap = minutes('B15_CAP_SECONDS', 300) * 1000;
      const a = await backupUnderLoad(s, {
        secondWriter: false,
        loadSeconds: 90,
        backupAtS: 20,
        cap,
      });
      const b = await backupUnderLoad(s, {
        secondWriter: true,
        loadSeconds: Math.ceil(cap / 1000) + 30,
        backupAtS: 20,
        cap,
      });
      r.check(
        'single write connection: backup completes',
        a.bk.status,
        '201',
        a.bk.status === 201,
        `${a.bk.ms} ms`,
      );
      const slower = b.bk.status !== 201 || b.bk.ms > 3 * a.bk.ms;
      r.check(
        'second writing connection: backup restarts or stalls (observation)',
        b.bk.status === 201 ? `completed in ${b.bk.ms} ms` : `no completion within ${cap / 1000} s`,
        'restart or stall observed, recorded',
        slower ? true : null,
        slower
          ? 'confirms the single-connection rule of 10 s3.1'
          : 'similar speed: the rule is NOT confirmed at this load; record it and tell the Human',
      );
      return { single: { ...a, j: undefined }, second: { ...b, j: undefined } };
    },
  },

  b06: {
    title: 'kill -9 mid-batch',
    spec: '10 s15 B6; 17 M2 exit',
    async run(r) {
      await restartApi();
      const s = await session();
      const before = counts();
      const lg = await load(s, { rate: 20, batch: 200, duration: 40 });
      await sleep(15_000);
      run('docker', ['kill', '-s', 'KILL', API]);
      await sleep(3_000);
      let up = await healthy(15);
      if (!up) {
        compose(['start', 'api']);
        up = await healthy(60);
      }
      const j = await lg.promise;
      const re = await resendUnacked(BASE, s.shift.client_id, j.state);
      const integ = integrity();
      const added = counts().points - before.points;
      r.check('api came back after kill -9', up, 'true', up);
      r.check('integrity_check', integ.integrity, 'ok', integ.integrity === 'ok');
      r.check('foreign_key_check rows', integ.fk, '0', integ.fk === 0);
      r.check(
        'rows added after resending unacknowledged batches',
        added,
        `== ${j.points_generated} (no gaps, no duplicates)`,
        added === j.points_generated,
        `resent ${re.resent} batches, inserted ${re.inserted}, duplicates ${re.duplicates}`,
      );
      return { first: { ...j, state: undefined }, resend: re, integ };
    },
  },

  b07: {
    title: 'Power pull (qm stop)',
    spec: '10 s15 B7; 17 M3 exit',
    async run(r, phase = process.argv[3]) {
      const journal = path.join(ART, 'b07-journal.jsonl');
      if (phase === 'start') {
        const s = await session();
        fs.rmSync(journal, { force: true });
        const devices = await pairDevices(BASE, s.cookie, devicesFor(20), 'b07');
        const config = path.join(ART, 'b07-config.json');
        fs.writeFileSync(
          config,
          JSON.stringify({
            base: BASE,
            shiftClientId: s.shift.client_id,
            devices,
            rate: 20,
            batch: 200,
            duration: 900,
            journalFile: journal,
          }),
        );
        spawn(process.execPath, [path.join(HERE, 'lib', 'loadgen.mjs'), '--config', config], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        console.log(
          'Load running for 15 minutes (one fsync per acknowledged batch).\nNow force-stop the VM from the Proxmox host:  qm stop <vmid>\nAfter boot: docker compose ... up -d if it did not start itself, then: node infra/vm-tests/run.mjs b07 check',
        );
        return null;
      }
      if (!(await healthy(180))) throw new Error('api not healthy after boot');
      const lines = fs
        .readFileSync(journal, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const islands = query(ISLANDS_SQL);
      const present = (l) =>
        islands.some((i) => i.device_id === l.device && i.lo <= l.from && i.hi >= l.from + l.n - 1);
      const missing = lines.filter((l) => !present(l));
      const lastAck = Math.max(...lines.map((l) => l.t));
      const lostSpanS = missing.length
        ? (lastAck - Math.min(...missing.map((m) => m.t))) / 1000
        : 0;
      const integ = integrity();
      r.check('integrity_check', integ.integrity, 'ok', integ.integrity === 'ok');
      r.check('foreign_key_check rows', integ.fk, '0', integ.fk === 0);
      r.check(
        'acknowledged batches missing after the power pull',
        missing.length,
        'only the last few seconds',
        lostSpanS <= 5,
        `lost span ${lostSpanS} s of ${lines.length} acknowledged batches; 5 s is a (new) reading of "last few seconds"`,
      );
      return { acked: lines.length, missing: missing.slice(0, 50) };
    },
  },

  b08: {
    title: 'Restore drill on a fresh host (DESTRUCTIVE: down -v)',
    spec: '10 s15 B8, s7; 17 M3 exit',
    async run(r) {
      const s = await session();
      if (!s.recoveryKey)
        throw new Error(
          'no recovery key in artifacts/session.json: the instance was set up outside this runner',
        );
      const off = path.join(ART, 'b08-offsite');
      fs.rmSync(off, { recursive: true, force: true });
      fs.mkdirSync(off, { recursive: true });
      const lg = await load(s, { rate: 20, batch: 200, duration: 60 });
      await lg.promise;
      await backupSlot(s);
      const bk = await postBackup(s, 900_000);
      if (bk.status !== 201) throw new Error(`backup failed: ${JSON.stringify(bk)}`);
      const expected = counts();
      const file = newestBackup();
      const local = path.join(off, file);
      run('docker', ['cp', `${API}:/app/backups/${file}`, local]); // the off-site copy
      const key = s.recoveryKey; // the "recovery card"
      compose(['down', '-v']);
      compose(['up', '-d']);
      if (!(await healthy(120))) throw new Error('fresh stack not healthy');
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(local)]), file);
      fd.append('recovery_key', key);
      const t0 = Date.now();
      const res = await fetch(`${BASE}/api/v1/setup/restore`, { method: 'POST', body: fd });
      const ms = Date.now() - t0;
      const v = await res.json();
      r.check(
        'restore succeeded (POST /setup/restore)',
        res.status,
        '200',
        res.status === 200,
        JSON.stringify(v).slice(0, 200),
      );
      r.check(
        'shifts after restore',
        v.shift_count,
        `== ${expected.shifts}`,
        v.shift_count === expected.shifts,
      );
      r.check(
        'telemetry points after restore',
        v.point_count,
        `== ${expected.points}`,
        v.point_count === expected.points,
      );
      r.check('integrity after restore', v.integrity_ok, 'true', v.integrity_ok === true);
      r.check('restore generation bumped', v.restore_generation, '>= 1', v.restore_generation >= 1);
      r.check('restore time (upload + decrypt + swap + verify)', ms, 'report only', null);
      const again = await session(); // the old owner can sign in on the restored instance
      r.check(
        'the old owner can sign in again',
        Boolean(again.cookie),
        'true',
        Boolean(again.cookie),
      );
      return { expected, restore: v, ms };
    },
  },

  b09: {
    title: 'Migration drill on a ~1 GB database',
    spec: '10 s15 B9, s10; 17 M3 exit',
    async run(r, phase = process.argv[3] || 'all') {
      const s = await session();
      const tools = path.join(HERE, 'tools');
      const offline = (script) =>
        compose([
          'run',
          '--rm',
          '--no-deps',
          '-e',
          'NODE_PATH=/app/node_modules',
          '--entrypoint',
          'node',
          'api',
          '-e',
          script,
        ]);
      const migrationSql = (sql) =>
        `const D=require('better-sqlite3');const d=new D('/app/data/milewage.db');${sql};d.close()`;
      if (phase === 'seed' || phase === 'all') {
        const [device] = await pairDevices(BASE, s.cookie, 1, 'seed');
        compose(['stop', 'api']);
        console.log('seeding about 1 GB (14 million rows)...');
        compose([
          'run',
          '--rm',
          '--no-deps',
          '-e',
          'NODE_PATH=/app/node_modules',
          '-v',
          `${tools}:/tools:ro`,
          '--entrypoint',
          'node',
          'api',
          '/tools/seed.cjs',
          '--data-dir',
          '/app/data',
          '--rows',
          String(minutes('B9_ROWS', 14_000_000)),
          '--device',
          String(device.id),
          '--shift',
          String(s.shift.id),
        ]);
        compose(['up', '-d']);
        if (!(await healthy(600))) throw new Error('not healthy after seeding');
        if (phase === 'seed') return null;
      }
      const before = { ...integrity(), ...counts() };
      // A pending migration is made by forgetting that 0006 was applied. Forced failure: leave its column in
      // place, so ALTER TABLE ADD COLUMN fails with "duplicate column name" and the transaction must roll back.
      compose(['stop', 'api']);
      offline(
        migrationSql(
          'd.prepare("DELETE FROM schema_migrations WHERE id = \'0006_setup_confirmation\'").run()',
        ),
      );
      const t0 = Date.now();
      compose(['up', '-d', 'api']);
      const up1 = await healthy(1800);
      const failMs = Date.now() - t0;
      const status = await call(BASE, '/api/v1/system/status', { cookie: s.cookie });
      const read = await call(BASE, '/api/v1/vehicles', { cookie: s.cookie });
      const pre1 = exec(['sh', '-c', 'ls /app/backups/pre-migration | wc -l']);
      const afterFail = { ...integrity(), ...counts() };
      r.check(
        'forced failure: server is up in read-only mode',
        `${status.json?.mode} / ${read.json?.code}`,
        'read_only / read_only_mode',
        status.json?.mode === 'read_only' && read.json?.code === 'read_only_mode',
        `healthy after ${failMs} ms (includes the pre-migration backup)`,
      );
      r.check(
        'forced failure: a verified pre-migration backup was taken first',
        Number(pre1),
        '>= 1',
        Number(pre1) >= 1,
      );
      r.check(
        'forced failure: schema and rows untouched',
        `${afterFail.migrations} migrations, ${afterFail.points} points`,
        `${before.migrations - 1} migrations, ${before.points} points`,
        afterFail.migrations === before.migrations - 1 && afterFail.points === before.points,
      );
      r.check(
        'forced failure: integrity_check',
        afterFail.integrity,
        'ok',
        afterFail.integrity === 'ok',
      );
      r.check('the server came up at all after the failed upgrade', up1, 'true', up1);
      // Real migration: drop the column too, so 0006 applies cleanly on the big database.
      compose(['stop', 'api']);
      offline(migrationSql("d.exec('ALTER TABLE instance DROP COLUMN setup_confirmed_at')"));
      const t1 = Date.now();
      compose(['up', '-d', 'api']);
      const up2 = await healthy(1800);
      const migrateMs = Date.now() - t1;
      const ok = await call(BASE, '/api/v1/system/status', { cookie: s.cookie });
      const pre2 = exec(['sh', '-c', 'ls /app/backups/pre-migration | wc -l']);
      const afterOk = { ...integrity(), ...counts() };
      r.check(
        'migration applied, server back to normal',
        ok.json?.mode,
        'normal',
        up2 && ok.json?.mode === 'normal',
      );
      r.check(
        'pre-migration backups present (last 3 kept)',
        Number(pre2),
        '>= 1',
        Number(pre2) >= 1,
      );
      r.check(
        'rows and migrations as before',
        `${afterOk.migrations} migrations, ${afterOk.points} points`,
        `${before.migrations} migrations, ${before.points} points`,
        afterOk.migrations === before.migrations && afterOk.points === before.points,
      );
      r.check('integrity_check', afterOk.integrity, 'ok', afterOk.integrity === 'ok');
      r.check(
        'time from start to healthy with the migration (includes the 1 GB pre-migration backup)',
        migrateMs,
        'report only',
        null,
        'the Docker HEALTHCHECK start period is 10 s: if this is long, decide whether to listen first (17 M3 fallback)',
      );
      return { before, afterFail, afterOk, failMs, migrateMs };
    },
  },

  b10: {
    title: 'Low disk (needs DATA_SRC on a small loop mount)',
    spec: '10 s15 B10, s11.3; 17 M3 exit',
    async run(r, phase = process.argv[3] || 'run') {
      const src = process.env.DATA_SRC;
      if (!src) throw new Error('set DATA_SRC to the small loop mount (README, B10 setup)');
      const free = () => Number(sh(`df -B1M --output=avail ${src} | tail -1`));
      const filler = path.join(src, 'FILLER');
      const fillTo = (mbFree) => {
        fs.rmSync(filler, { force: true });
        const target = free() - mbFree;
        if (target > 0) sh(`fallocate -l ${target}M ${filler}`);
      };
      if (phase === 'prepare') {
        compose(['down', '-v']);
        compose(['up', '-d']);
        if (!(await healthy(120))) throw new Error('stack not healthy');
        const s = await session();
        const [device] = await pairDevices(BASE, s.cookie, 1, 'b10');
        fs.writeFileSync(path.join(ART, 'b10-device.json'), JSON.stringify(device));
        compose(['stop', 'api']);
        compose([
          'run',
          '--rm',
          '--no-deps',
          '-e',
          'NODE_PATH=/app/node_modules',
          '-v',
          `${path.join(HERE, 'tools')}:/tools:ro`,
          '--entrypoint',
          'node',
          'api',
          '/tools/seed.cjs',
          '--data-dir',
          '/app/data',
          '--rows',
          String(minutes('B10_ROWS', 2_000_000)),
          '--device',
          String(device.id),
          '--shift',
          String(s.shift.id),
        ]);
        compose(['up', '-d']);
        if (!(await healthy(120))) throw new Error('stack not healthy after seeding');
        console.log('prepared (about 150 MB database). Now: node infra/vm-tests/run.mjs b10');
        return null;
      }
      const s = await session();
      const device = JSON.parse(fs.readFileSync(path.join(ART, 'b10-device.json'), 'utf8'));
      const status = async () =>
        (await call(BASE, '/api/v1/system/status', { cookie: s.cookie })).json;
      const post = (seq) =>
        call(BASE, '/api/v1/telemetry/batch', {
          method: 'POST',
          bearer: device.token,
          body: {
            shift_client_id: s.shift.client_id,
            points: [
              {
                seq,
                recorded_at: Date.now() - 1000,
                lat_e7: 377749290,
                lon_e7: -1224194160,
                accuracy_m: 5,
              },
            ],
          },
        });
      const sizeMb = (await status()).db_bytes / 1048576;
      let seq = 1;
      fillTo(900);
      await sleep(1500);
      let st = await status();
      r.check('free about 900 MB: warning', st.disk_state, 'warning', st.disk_state === 'warning');
      fillTo(Math.max(210, Math.round(sizeMb * 2 - 20)));
      await sleep(1500);
      st = await status();
      const bk = await call(BASE, '/api/v1/backups', { method: 'POST', cookie: s.cookie });
      r.check(
        'below 2x the database: backup skipped with an error',
        `${st.disk_state} / POST /backups ${bk.status}`,
        'backup_skipped / 507',
        st.disk_state === 'backup_skipped' && bk.status === 507,
        `database ${Math.round(sizeMb)} MB`,
      );
      fillTo(150);
      await sleep(1500);
      st = await status();
      const w = await post(seq++);
      const reads = await call(BASE, '/api/v1/shifts?limit=5', { cookie: s.cookie });
      const hz = await fetch(`${BASE}/healthz`);
      r.check(
        'below 200 MB: disk state',
        st.disk_state,
        'writes_blocked',
        st.disk_state === 'writes_blocked',
      );
      r.check('below 200 MB: writes return 507', w.status, '507', w.status === 507);
      r.check('below 200 MB: reads still work', reads.status, '200', reads.status === 200);
      r.check('below 200 MB: /healthz still 200', hz.status, '200', hz.status === 200);
      fs.rmSync(filler, { force: true });
      await sleep(1500);
      const w2 = await post(seq++);
      r.check('after freeing space: writes resume', w2.status, '200', w2.status === 200);
      return { size_mb: sizeMb };
    },
  },

  b11: {
    title: 'Write volume per driving hour (informational)',
    spec: '10 s15 B11; 12 s16',
    async run(r) {
      await restartApi();
      const s = await session();
      const mins = minutes('B11_MINUTES', 5);
      const w0 = writeBytes();
      const devices = await pairDevices(BASE, s.cookie, 2, 'b11');
      const j = await runLoad({
        base: BASE,
        shiftClientId: s.shift.client_id,
        devices,
        rate: 1,
        batch: 20,
        duration: mins * 60,
      });
      const w1 = writeBytes();
      r.check(
        'bytes written per simulated driving hour',
        Math.round((w1 - w0) / mins),
        'report only (SD-card wear is deferred, 12 s16)',
        null,
        `loadgen ok ${j.ok}`,
      );
      return { loadgen: { ...j, state: undefined } };
    },
  },

  b12: {
    title: 'SQLite version',
    spec: '10 s3.3, s15 B12; 17 M2 exit',
    async run(r) {
      const s = await session();
      const v = (await call(BASE, '/api/v1/system/status', { cookie: s.cookie })).json
        .sqlite_version;
      const [, minor, patch] = v.split('.').map(Number);
      const ok =
        minor >= 52 ||
        (minor === 51 && patch >= 3) ||
        (minor === 50 && patch >= 7) ||
        (minor === 44 && patch >= 6);
      r.check(
        'bundled SQLite version',
        v,
        '>= 3.51.3 / 3.50.7 / 3.44.6 in its series',
        ok,
        `node ${exec(['node', '-v'])}`,
      );
      return { sqlite_version: v };
    },
  },

  b13: {
    title: 'Module flags',
    spec: '08 s16; 17 M2 exit',
    async run(r) {
      const s = await session();
      const [device] = await pairDevices(BASE, s.cookie, 1, 'b13');
      const code = async (p, o = {}) => (await call(BASE, p, o)).status;
      const batch = {
        shift_client_id: s.shift.client_id,
        points: [
          {
            seq: 1,
            recorded_at: Date.now() - 1000,
            lat_e7: 377749290,
            lon_e7: -1224194160,
            accuracy_m: 5,
          },
        ],
      };
      const telemetry = () =>
        code('/api/v1/telemetry/batch', { method: 'POST', bearer: device.token, body: batch });
      const events = () =>
        code('/api/v1/diagnostics/events', {
          method: 'POST',
          bearer: device.token,
          body: { events: [] },
        });
      const coreOk = async () =>
        (await call(BASE, '/api/v1/system/status', { cookie: s.cookie })).status === 200;

      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_TRACKING: '0' });
      await healthy(60);
      const t = await telemetry();
      r.check('tracking off: ingest is 404', t, '404', t === 404);
      r.check(
        'tracking off: core and diagnostics unaffected',
        `${await coreOk()} / ${await events()}`,
        'true / 422',
        (await coreOk()) && (await events()) === 422,
      );

      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_DIAGNOSTICS: '0' });
      await healthy(60);
      const e = await events();
      r.check('diagnostics off: ingest is 404', e, '404', e === 404);
      r.check(
        'diagnostics off: tracking and core unaffected',
        `${await coreOk()} / ${await telemetry()}`,
        'true / 200',
        (await coreOk()) && (await telemetry()) === 200,
      );

      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_DEVICES: '0' });
      await sleep(8_000);
      const logs = sh(`docker logs --tail 30 ${API} 2>&1`); // the refusal goes to the container's stderr
      const refused = /enabled but depends on "devices"/.test(logs) && !(await healthy(3));
      r.check(
        'devices off while tracking is on: refuses to start with a clear message',
        refused,
        'refusal in the logs, no listener',
        refused,
        logs.split('\n').find((l) => /depends on/.test(l)) ?? '',
      );

      compose(['stop', 'api']);
      compose(['up', '-d', 'api']);
      await healthy(60); // defaults again
      return { logs };
    },
  },

  b14: {
    title: 'Encrypted backup opens with the standard Go age tool',
    spec: '10 s4, s15 B14; 17 M3 exit',
    async run(r) {
      try {
        sh('which age gunzip');
      } catch {
        throw new Error('install the Go age tool on the VM first: apt install age');
      }
      await restartApi();
      const s = await session();
      if (!s.recoveryKey)
        throw new Error(
          'no recovery key in artifacts/session.json: the instance was set up outside this runner',
        );
      const expected = counts();
      await backupSlot(s);
      const bk = await postBackup(s, 900_000);
      const hwm = proc(API).hwm;
      if (bk.status !== 201) throw new Error(`backup failed: ${JSON.stringify(bk)}`);
      const dir = path.join(ART, 'b14');
      fs.mkdirSync(dir, { recursive: true });
      const file = newestBackup();
      const keyFile = path.join(dir, 'recovery-key.txt');
      fs.writeFileSync(keyFile, `${s.recoveryKey}\n`, { mode: 0o600 });
      run('docker', ['cp', `${API}:/app/backups/${file}`, path.join(dir, file)]);
      sh(
        `age -d -i ${keyFile} ${path.join(dir, file)} | gunzip > ${path.join(dir, 'standard-age.db')}`,
      );
      run('docker', ['cp', path.join(dir, 'standard-age.db'), `${API}:/tmp/standard-age.db`]);
      const script =
        "const D=require('better-sqlite3');const d=new D('/tmp/standard-age.db',{readonly:true});" +
        "console.log(JSON.stringify({i:d.pragma('integrity_check',{simple:true}),p:d.prepare('select count(*) c from telemetry_points').get().c}))";
      const copy = JSON.parse(exec(['node', '-e', script]));
      exec(['rm', '-f', '/tmp/standard-age.db']);
      r.check(
        'the standard Go age tool decrypts a file written by the pinned age-encryption',
        copy.i,
        'ok',
        copy.i === 'ok',
      );
      r.check(
        'decrypted copy has the rows',
        copy.p,
        `>= ${expected.points}`,
        copy.p >= expected.points,
      );
      r.check(
        'api peak RSS while backing up (streams, does not buffer)',
        hwm,
        '<= 120 MB',
        hwm <= 120,
        `${bk.ms} ms, ${bk.json.size_bytes} B`,
      );
      return { backup: bk.json };
    },
  },

  b16: {
    title: 'Diagnostics under load',
    spec: '16 s9.2; 10 s15 B16; 17 M3 exit',
    async run(r) {
      const s = await session();
      await backupSlot(s); // before the load starts, so the backup lands inside it
      await restartApi();
      const secs = minutes('B16_SECONDS', 240);
      const diagDevices = await pairDevices(BASE, s.cookie, devicesFor(50 / 20, 0.45), 'b16diag');
      const lg = await load(s, {
        rate: 50,
        batch: 200,
        duration: secs,
        diag: { devices: diagDevices, eventsPerSecond: 50, perBatch: 20 },
      });
      await sleep(Math.min(90, Math.floor(secs / 3)) * 1000);
      const bk = await postBackup(s, 1_800_000);
      const j = await lg.promise;
      r.check(
        'diagnostics ingest p99',
        j.diagnostics.latency_ms.p99,
        '< 100 ms',
        j.diagnostics.latency_ms.p99 < 100,
        `${j.diagnostics.ok} batches, p50 ${j.diagnostics.latency_ms.p50}, max ${j.diagnostics.latency_ms.max}`,
      );
      r.check(
        'telemetry write p99 with diagnostics running',
        j.latency_ms.p99,
        '< 100 ms',
        j.latency_ms.p99 < 100,
      );
      r.check(
        'backup completed and its copy passed integrity_check (server-side check)',
        bk.status,
        '201 with integrity_ok',
        bk.status === 201 && bk.json?.integrity_ok === true,
        `${bk.ms} ms`,
      );
      r.check(
        'SQLITE_BUSY seen by clients (both streams)',
        j.busy + j.diagnostics.busy,
        '0',
        j.busy + j.diagnostics.busy === 0,
      );
      r.check(
        'non-200 responses + network errors (telemetry / diagnostics)',
        `${nonOk(j)} / ${nonOk(j.diagnostics)}`,
        '0 / 0',
        nonOk(j) === 0 && nonOk(j.diagnostics) === 0,
        JSON.stringify(j.diagnostics.byStatus),
      );
      r.check(
        'event-loop lag with the module on vs off',
        'not measured',
        'spec: <= 100 ms worse',
        null,
        'the server does not report loop lag yet',
      );
      return { backup: bk, loadgen: { ...j, state: undefined } };
    },
  },

  b17: {
    title: 'Diagnostics idle cost',
    spec: '16 s9.2; 10 s15 B17; 17 M3 exit',
    async run(r) {
      const mins = minutes('B17_MINUTES', 30);
      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_DIAGNOSTICS: '1' });
      const on = await idleRun(mins);
      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_DIAGNOSTICS: '0' });
      const off = await idleRun(mins);
      compose(['up', '-d', 'api'], { MILEWAGE_MODULE_DIAGNOSTICS: '' });
      await healthy(60);
      const dr = Math.round((on.peak - off.peak) * 10) / 10;
      const dc = Math.round((on.avgCpu - off.avgCpu) * 100) / 100;
      r.check(
        'RSS difference, module on minus off',
        dr,
        '<= 5 MB',
        dr <= 5,
        `on ${on.peak} MB, off ${off.peak} MB`,
      );
      r.check(
        'CPU difference, module on minus off',
        dc,
        '< 0.1 %',
        dc < 0.1,
        `on ${Math.round(on.avgCpu * 100) / 100}, off ${Math.round(off.avgCpu * 100) / 100}`,
      );
      return { on: on.samples.length, off: off.samples.length };
    },
  },
};

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , name] = process.argv;
  if (!name || name === 'list' || !TESTS[name]) {
    for (const [id, t] of Object.entries(TESTS))
      console.log(`${id.padEnd(4)} ${t.title}  [${t.spec}]`);
    process.exit(name && name !== 'list' ? 1 : 0);
  }
  const report = makeReport(name);
  try {
    const raw = await TESTS[name].run(report);
    process.exit(raw === null && report.results.length === 0 ? 0 : report.finish(raw));
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    process.exit(2);
  }
}
