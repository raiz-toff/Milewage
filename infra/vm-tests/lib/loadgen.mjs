// Open-loop load generator for the product API (Spike B tools/loadgen.js, ported). It sends gzip
// telemetry batches at a fixed rate whether or not the server keeps up, spread over many paired
// phones because the product limits each phone to 60 batches a minute (08 section 7.4), and can
// add a diagnostics stream and a once-a-second reader. Results are one JSON object.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import zlib from 'node:zlib';
import { call } from './api.mjs';
import { parseArgs, pct } from './stats.mjs';

const MAX_DEVICE_RATE = 0.9; // requests per second per phone, under the 1/s refill of its bucket

/** Phones needed to carry `rate` requests per second without hitting the per-phone limit. */
export const devicesFor = (rate, perDevice = MAX_DEVICE_RATE) =>
  Math.max(1, Math.ceil(rate / perDevice));

/** One telemetry batch for a phone, `n` points starting at `from`. */
export function telemetryBody(shiftClientId, from, n, now = Date.now()) {
  const points = [];
  for (let i = 0; i < n; i++) {
    const s = from + i;
    points.push({
      seq: s,
      recorded_at: now - 30_000 + i,
      lat_e7: 377749290 + (s % 5000) * 37,
      lon_e7: -1224194160 + (s % 7000) * 23,
      accuracy_m: 5 + (s % 9),
      speed_dmps: 80 + (s % 40),
      bearing_deg: s % 360,
      altitude_m: 15,
    });
  }
  return zlib.gzipSync(JSON.stringify({ shift_client_id: shiftClientId, points }));
}

/** A diagnostics batch of `n` `upload.window` events (16 section 3.2), seq from `from`. */
export function diagnosticsBody(from, n, now = Date.now()) {
  const events = [];
  for (let i = 0; i < n; i++) {
    events.push({
      kind: 'upload.window',
      at: now,
      level: 'basic',
      src: 'phone_js',
      seq: from + i,
      v: '0.1.0',
      data: {
        attempts: 1,
        ok: 1,
        fail_net: 0,
        fail_4xx: 0,
        fail_5xx: 0,
        fail_429: 0,
        fail_507: 0,
        bytes_gz: 1000,
        dur_p95_ms: 200,
        pending_points: 0,
        oldest_pending_s: 0,
      },
    });
  }
  return zlib.gzipSync(JSON.stringify({ events }));
}

const newStats = () => ({
  sent: 0,
  ok: 0,
  byStatus: {},
  netErrors: 0,
  busy: 0,
  inserted: 0,
  duplicates: 0,
  rejected: 0,
});

async function post(base, path, device, payload, stat, onOk) {
  const t0 = performance.now();
  stat.sent++;
  try {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        authorization: `Bearer ${device.token}`,
      },
      body: payload,
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    stat.byStatus[res.status] = (stat.byStatus[res.status] || 0) + 1;
    if (/SQLITE_BUSY/.test(text)) stat.busy++;
    if (res.status === 200) {
      stat.ok++;
      onOk(JSON.parse(text), ms);
      return true;
    }
  } catch {
    stat.netErrors++;
  }
  return false;
}

/**
 * Options: base, shiftClientId, devices [{id, token, nextSeq}], rate (req/s), batch (points),
 * duration (s). Optional: diag {devices, eventsPerSecond, perBatch}, reader {cookie, shiftId},
 * journalFile (one fsync'd line per acknowledged batch), seriesFile (per-second latency CSV).
 * Returns the stats plus `batches` so a later `resendUnacked` can replay what was not acknowledged.
 */
export async function runLoad(o) {
  const stat = newStats();
  const latencies = [];
  const series = new Map();
  const batches = [];
  const started = Date.now();
  let lastOk = null;
  let maxGap = 0;
  const devices = o.devices;
  const journal = o.journalFile ? fs.openSync(o.journalFile, 'a') : null;

  const send = async (b) => {
    const dev = devices[b.device];
    await post(o.base, '/api/v1/telemetry/batch', dev, b.payload, stat, (json, ms) => {
      stat.inserted += json.inserted;
      stat.duplicates += json.duplicates;
      stat.rejected += json.rejected.length;
      b.acked = true;
      latencies.push(ms);
      const sec = Math.floor((Date.now() - started) / 1000);
      if (!series.has(sec)) series.set(sec, []);
      series.get(sec).push(ms);
      const now = performance.now();
      if (lastOk !== null) maxGap = Math.max(maxGap, now - lastOk);
      lastOk = now;
      if (journal !== null) {
        fs.writeSync(
          journal,
          `${JSON.stringify({ t: Date.now(), device: dev.id, from: b.from, n: b.n })}\n`,
        );
        fs.fsyncSync(journal);
      }
    });
  };

  const readerLat = [];
  let readerTimer;
  if (o.reader) {
    let flip = false;
    readerTimer = setInterval(async () => {
      const t = performance.now();
      flip = !flip;
      const path = flip ? `/api/v1/shifts/${o.reader.shiftId}` : '/api/v1/shifts?limit=200';
      try {
        const r = await call(o.base, path, { cookie: o.reader.cookie });
        if (r.status === 200) readerLat.push(performance.now() - t);
      } catch {
        /* counted by absence */
      }
    }, 1000);
  }

  const diagStat = newStats();
  const diagLat = [];
  let diagTimer;
  if (o.diag) {
    const perBatch = o.diag.perBatch ?? 20;
    const interval = 1000 / (o.diag.eventsPerSecond / perBatch);
    let n = 0;
    diagTimer = setInterval(() => {
      const dev = o.diag.devices[n++ % o.diag.devices.length];
      const from = dev.nextSeq;
      dev.nextSeq += perBatch;
      void post(
        o.base,
        '/api/v1/diagnostics/events',
        dev,
        diagnosticsBody(from, perBatch),
        diagStat,
        (json, ms) => {
          diagStat.inserted += json.accepted;
          diagStat.rejected += json.rejected.length;
          diagLat.push(ms);
        },
      );
    }, interval);
  }

  const cpu0 = process.cpuUsage();
  const inflight = new Set();
  const interval = 1000 / o.rate;
  let next = performance.now();
  let turn = 0;
  while (Date.now() - started < o.duration * 1000) {
    const device = turn++ % devices.length;
    const dev = devices[device];
    const b = {
      device,
      from: dev.nextSeq,
      n: o.batch,
      payload: telemetryBody(o.shiftClientId, dev.nextSeq, o.batch),
      acked: false,
    };
    dev.nextSeq += o.batch;
    batches.push(b);
    const p = send(b).finally(() => inflight.delete(p));
    inflight.add(p);
    next += interval;
    const wait = next - performance.now();
    if (wait > 0) await sleep(wait);
  }
  await Promise.allSettled([...inflight]);
  clearInterval(readerTimer);
  clearInterval(diagTimer);
  await sleep(o.diag ? 500 : 0);
  if (journal !== null) fs.closeSync(journal);
  const cpu = process.cpuUsage(cpu0);

  if (o.seriesFile) {
    const rows = [...series]
      .sort((a, b) => a[0] - b[0])
      .map(([s, v]) => `${s},${v.length},${pct(v, 0.95)},${pct(v, 1)}`);
    fs.writeFileSync(o.seriesFile, `second,count,p95_ms,max_ms\n${rows.join('\n')}\n`);
  }
  return {
    rate: o.rate,
    batch: o.batch,
    duration_s: o.duration,
    devices: devices.length,
    ...stat,
    latency_ms: {
      p50: pct(latencies, 0.5),
      p95: pct(latencies, 0.95),
      p99: pct(latencies, 0.99),
      max: pct(latencies, 1),
    },
    max_gap_between_successes_ms: Math.round(maxGap),
    reader: o.reader
      ? { count: readerLat.length, p95_ms: pct(readerLat, 0.95), max_ms: pct(readerLat, 1) }
      : null,
    diagnostics: o.diag
      ? {
          ...diagStat,
          latency_ms: {
            p50: pct(diagLat, 0.5),
            p95: pct(diagLat, 0.95),
            p99: pct(diagLat, 0.99),
            max: pct(diagLat, 1),
          },
        }
      : null,
    loadgen_cpu_s: Math.round((cpu.user + cpu.system) / 1e4) / 100,
    points_generated: batches.reduce((s, b) => s + b.n, 0),
    state: {
      devices: devices.map((d) => ({ ...d })),
      batches: batches.map(({ device, from, n, acked }) => ({ device, from, n, acked })),
    },
  };
}

/** The phone's behaviour after a crash: send again every batch that was not acknowledged. */
export async function resendUnacked(base, shiftClientId, state) {
  const stat = newStats();
  let resent = 0;
  for (const b of state.batches.filter((x) => !x.acked)) {
    resent++;
    await post(
      base,
      '/api/v1/telemetry/batch',
      state.devices[b.device],
      telemetryBody(shiftClientId, b.from, b.n),
      stat,
      (json) => {
        stat.inserted += json.inserted;
        stat.duplicates += json.duplicates;
        stat.rejected += json.rejected.length;
      },
    );
  }
  return { resent, ...stat };
}

// CLI, used where the load must outlive the runner (B7): node lib/loadgen.mjs --config config.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const result = await runLoad(config);
  if (config.stateFile) fs.writeFileSync(config.stateFile, JSON.stringify(result.state));
  console.log(JSON.stringify({ ...result, state: undefined }, null, 1));
}
