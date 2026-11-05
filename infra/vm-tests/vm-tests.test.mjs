// Self-checks (a dry run) for the VM test scripts: they run on any machine, without Docker or the VM.
// The real results are produced by hand on the Proxmox VM (README.md); nothing here is a result.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { startServer } from '../../apps/server/src/index';
import { call, ensureSession, pairDevices } from './lib/api.mjs';
import { compose, dryRun } from './lib/docker.mjs';
import { devicesFor, resendUnacked, runLoad, telemetryBody } from './lib/loadgen.mjs';
import { pct, parseArgs } from './lib/stats.mjs';
import { ISLANDS_SQL, TESTS, makeReport } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('the test list', () => {
  test('B1-B17 are all there, each with a title, a spec reference and a function', () => {
    expect(Object.keys(TESTS)).toEqual([
      'b01',
      'b02',
      'b03',
      'b04',
      'b05',
      'b15',
      'b06',
      'b07',
      'b08',
      'b09',
      'b10',
      'b11',
      'b12',
      'b13',
      'b14',
      'b16',
      'b17',
    ]);
    for (const [id, t] of Object.entries(TESTS)) {
      expect(t.title, id).toBeTruthy();
      expect(t.spec, id).toMatch(/\d/);
      expect(typeof t.run, id).toBe('function');
    }
  });

  test('`run.mjs list` prints them and exits 0; an unknown test exits 1', () => {
    const out = execFileSync(process.execPath, [path.join(HERE, 'run.mjs'), 'list'], {
      encoding: 'utf8',
    });
    expect(out.trim().split('\n')).toHaveLength(17);
    expect(spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), 'b99']).status).toBe(1);
  });

  test('the report marks FAIL, PASS and INFO, and a FAIL means a non-zero exit code', () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = makeReport('selfcheck');
    r.check('a', 1, '<= 2', true);
    r.check('b', 3, '<= 2', false);
    r.check('c', 9, 'report only', null);
    expect(r.results.map((x) => x.verdict)).toEqual(['PASS', 'FAIL', 'INFO']);
    expect(r.finish({})).toBe(1);
    quiet.mockRestore();
    fs.readdirSync(path.join(HERE, 'artifacts'))
      .filter((f) => f.startsWith('selfcheck-'))
      .forEach((f) => fs.rmSync(path.join(HERE, 'artifacts', f)));
  });
});

describe('helpers', () => {
  test('percentiles and arguments', () => {
    expect(pct([], 0.5)).toBeNull();
    expect(pct([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(
      pct(
        Array.from({ length: 100 }, (_, i) => i + 1),
        0.99,
      ),
    ).toBe(100);
    expect(parseArgs(['--rate', '5', '--reader', '--config', 'x.json'])).toEqual({
      rate: '5',
      reader: true,
      config: 'x.json',
    });
  });

  test('one phone carries at most 0.9 batches a second, so 50 req/s needs 56 phones', () => {
    expect(devicesFor(50)).toBe(56);
    expect(devicesFor(1)).toBe(2);
    expect(devicesFor(0.5)).toBe(1);
  });

  test('DRY_RUN prints the docker command with both compose files and runs nothing', () => {
    process.env.DRY_RUN = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(dryRun()).toBe(true);
    expect(compose(['up', '-d', 'api'], { X: '1' })).toBe('');
    expect(log).toHaveBeenCalledWith(
      'DRY docker compose -p mwvm -f infra/docker/docker-compose.yml -f infra/vm-tests/docker-compose.vm.yml up -d api',
    );
    log.mockRestore();
    delete process.env.DRY_RUN;
  });

  const hasDocker = spawnSync('docker', ['compose', 'version']).status === 0;
  test.skipIf(!hasDocker)('the compose override is valid next to the shipped compose file', () => {
    const out = execFileSync(
      'docker',
      [
        'compose',
        '-p',
        'mwvm',
        '-f',
        'infra/docker/docker-compose.yml',
        '-f',
        'infra/vm-tests/docker-compose.vm.yml',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: path.join(HERE, '..', '..'),
        encoding: 'utf8',
        env: { ...process.env, DATA_SRC: '/srv/b10', MILEWAGE_MODULE_TRACKING: '0' },
      },
    );
    const api = JSON.parse(out).services.api;
    expect(api.environment.MILEWAGE_MODULE_TRACKING).toBe('0');
    expect(api.environment.MILEWAGE_TRUST_PROXY).toBeTruthy(); // the shipped settings are kept
    const data = api.volumes.find((v) => v.target === '/app/data');
    expect(data.source === '/srv/b10' || data.type === 'bind').toBe(true);
    expect(api.volumes.filter((v) => v.target === '/app/data')).toHaveLength(1); // replaced, not appended
    expect(api.mem_limit ?? api.deploy?.resources?.limits?.memory).toBeTruthy(); // limits unchanged
  });
});

describe('against the real server, in process', () => {
  let app;
  let base;
  let dir;
  let stateFile;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-vmtests-'));
    app = await startServer({
      MILEWAGE_PORT: '0',
      MILEWAGE_HOST: '127.0.0.1',
      MILEWAGE_LOG_LEVEL: 'silent',
      MILEWAGE_DATA_DIR: path.join(dir, 'data'),
      MILEWAGE_CONFIG_DIR: path.join(dir, 'config'),
      MILEWAGE_BACKUP_DIR: path.join(dir, 'backups'),
    });
    base = `http://127.0.0.1:${app.fastify.server.address().port}`;
    stateFile = path.join(dir, 'session.json');
  });
  afterAll(async () => {
    await app.fastify.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('setup, confirm, sign-in again, one vehicle and one shift; pairing gives working phones', async () => {
    const first = await ensureSession(base, stateFile);
    expect(first.recoveryKey).toMatch(/^AGE-SECRET-KEY-1/);
    const again = await ensureSession(base, stateFile); // reuses the owner, vehicle and shift
    expect(again.shift).toEqual(first.shift);
    expect(again.recoveryKey).toBe(first.recoveryKey);
    fs.writeFileSync(stateFile, JSON.stringify({ ...first, cookie: 'mw_session=stale' }));
    const relogin = await ensureSession(base, stateFile); // a dead cookie is replaced by signing in
    expect((await call(base, '/api/v1/settings', { cookie: relogin.cookie })).status).toBe(200);
    const devices = await pairDevices(base, relogin.cookie, 2, 'selfcheck');
    expect(devices.map((d) => d.id)).toEqual([1, 2]);
    expect(devices[0].token).toMatch(/^mwd_/);
  });

  test('the load generator sends gzip batches that the server stores once; the journal and a replay agree', async () => {
    const s = await ensureSession(base, stateFile);
    const devices = await pairDevices(base, s.cookie, devicesFor(8), 'load');
    const journalFile = path.join(dir, 'journal.jsonl');
    const seriesFile = path.join(dir, 'series.csv');
    const j = await runLoad({
      base,
      shiftClientId: s.shift.client_id,
      devices,
      rate: 8,
      batch: 25,
      duration: 2,
      journalFile,
      seriesFile,
      reader: { cookie: s.cookie, shiftId: s.shift.id },
    });
    expect(j.sent).toBeGreaterThanOrEqual(10);
    expect([j.ok, j.rejected, j.busy, j.netErrors, j.byStatus['200']]).toEqual([
      j.sent,
      0,
      0,
      0,
      j.sent,
    ]);
    expect(j.inserted).toBe(j.points_generated);
    expect(j.duplicates).toBe(0);
    expect(j.latency_ms.p99).toBeGreaterThan(0);
    expect(j.reader.count).toBeGreaterThan(0);
    expect(fs.readFileSync(seriesFile, 'utf8').startsWith('second,count,p95_ms,max_ms')).toBe(true);
    const lines = fs
      .readFileSync(journalFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(j.ok);

    // B7 logic: every journalled batch is inside a run of consecutive seq present in the database.
    const islands = app.db.prepare(ISLANDS_SQL).all();
    const covered = (l) =>
      islands.some((i) => i.device_id === l.device && i.lo <= l.from && i.hi >= l.from + l.n - 1);
    expect(lines.every(covered)).toBe(true);
    const victim = lines[0];
    app.db
      .prepare('DELETE FROM telemetry_points WHERE device_id = ? AND seq = ?')
      .run(victim.device, victim.from + 3);
    const holes = app.db.prepare(ISLANDS_SQL).all();
    expect(
      holes.some(
        (i) =>
          i.device_id === victim.device &&
          i.lo <= victim.from &&
          i.hi >= victim.from + victim.n - 1,
      ),
    ).toBe(false);

    // B6 logic: resending only what was not acknowledged; everything acknowledged is skipped.
    expect((await resendUnacked(base, s.shift.client_id, j.state)).resent).toBe(0);
    const pretend = {
      devices: j.state.devices,
      batches: j.state.batches.map((b, i) => ({ ...b, acked: i % 2 === 0 })),
    };
    const re = await resendUnacked(base, s.shift.client_id, pretend);
    expect(re.resent).toBe(pretend.batches.filter((b) => !b.acked).length);
    expect(re.duplicates).toBeGreaterThan(0); // the server had them: idempotent on (device, seq)
  });

  test('the diagnostics stream is accepted event by event', async () => {
    const s = await ensureSession(base, stateFile);
    const diagDevices = await pairDevices(base, s.cookie, devicesFor(1, 0.45), 'diag');
    const devices = await pairDevices(base, s.cookie, 1, 'tel');
    const j = await runLoad({
      base,
      shiftClientId: s.shift.client_id,
      devices,
      rate: 1,
      batch: 5,
      duration: 3,
      diag: { devices: diagDevices, eventsPerSecond: 40, perBatch: 20 },
    });
    expect(j.diagnostics.ok).toBeGreaterThan(0);
    expect(j.diagnostics.rejected).toBe(0);
    expect(j.diagnostics.inserted).toBe(j.diagnostics.ok * 20);
    expect(j.busy + j.diagnostics.busy).toBe(0);
  });

  test('a batch built by the generator is accepted by the server schema when posted by hand', async () => {
    const s = await ensureSession(base, stateFile);
    const [device] = await pairDevices(base, s.cookie, 1, 'hand');
    const res = await fetch(`${base}/api/v1/telemetry/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        authorization: `Bearer ${device.token}`,
      },
      body: telemetryBody(s.shift.client_id, 1, 200),
    });
    expect([res.status, (await res.json()).inserted]).toEqual([200, 200]);
  });
});
