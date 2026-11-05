import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { arch } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import type { EventSubscriptions, ModuleJob } from '@milewage/shared';
import type { DiskMonitor } from '../disk';
import type { ServerRecorder } from './recorder';

const GROUPS = ['telemetry', 'shifts', 'sync', 'stops', 'exports', 'diagnostics', 'other'] as const;
type Group = (typeof GROUPS)[number];

/** Route group of a request path under `/api/v1` (16 section 3.2 `api.window`). */
export function groupOf(url: string): Group {
  const first = url.replace(/^\/api\/v1\//, '').split(/[/?]/)[0] ?? '';
  if (first === 'telemetry') return 'telemetry';
  if (first === 'shifts') return /\/(stops|stop-labels)(\/|$|\?)/.test(url) ? 'stops' : 'shifts';
  if (first === 'trips') return 'shifts';
  if (first === 'sync') return 'sync';
  if (first === 'exports') return 'exports';
  if (first === 'diagnostics') return 'diagnostics';
  return 'other';
}

const pct = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

interface Window {
  durations: number[];
  s2xx: number;
  s4xx: number;
  s5xx: number;
  codes: Map<string, number>;
}
const MAX_SAMPLES = 5000;

export interface MetricsOptions {
  recorder: ServerRecorder;
  now: () => number;
  disk?: DiskMonitor;
  /** The two database files whose sizes `server.sample` reports. */
  paths: () => { db: string; diag: string; bytes: (path: string) => number };
  /** Interval of the samples (15 minutes unless a test shortens it). */
  everyMs?: number;
  modules: () => Record<string, boolean>;
  schemaVersion: () => string;
  sqliteVersion: () => string;
  /** Marker file: present at start means the last run did not shut down cleanly. */
  markerPath?: string;
}

/**
 * The server's own measurements (16 section 7.3): Node's event-loop-delay histogram, process memory and CPU, file
 * sizes, and per-route-group request windows, recorded every 15 minutes. No agent, no `/proc`, no extra timer
 * beyond this one interval.
 */
export function createServerMetrics(o: MetricsOptions) {
  const windows = new Map<Group, Window>();
  const ingest = {
    points_in: 0,
    inserted: 0,
    duplicates: 0,
    rejected: { invalid_coordinate: 0, future_timestamp: 0, outside_shift_window: 0 },
  };
  const loop = monitorEventLoopDelay({ resolution: 100 });
  let cpu = process.cpuUsage();
  let since = o.now();
  let startNote: (() => Record<string, unknown>) | undefined;

  const windowOf = (g: Group): Window => {
    let w = windows.get(g);
    if (!w) windows.set(g, (w = { durations: [], s2xx: 0, s4xx: 0, s5xx: 0, codes: new Map() }));
    return w;
  };

  /** Counts one finished request; installed as an `onResponse` hook. */
  const observe = (url: string, status: number, ms: number, code?: string) => {
    const w = windowOf(groupOf(url));
    if (w.durations.length < MAX_SAMPLES) w.durations.push(ms);
    if (status >= 500) w.s5xx++;
    else if (status >= 400) w.s4xx++;
    else w.s2xx++;
    if (code) w.codes.set(code, (w.codes.get(code) ?? 0) + 1);
  };
  const install = (app: FastifyInstance) => {
    app.addHook('onResponse', async (req, reply) => {
      if (!req.url.startsWith('/api/v1/')) return;
      observe(
        req.url,
        reply.statusCode,
        reply.elapsedTime,
        (req as { problemCode?: string }).problemCode,
      );
    });
  };

  const subscriptions: EventSubscriptions = {
    'telemetry.batch'(p) {
      ingest.points_in += p.received;
      ingest.inserted += p.inserted;
      ingest.duplicates += p.duplicates;
      for (const k of Object.keys(ingest.rejected) as (keyof typeof ingest.rejected)[]) {
        ingest.rejected[k] += p.rejected[k] ?? 0;
      }
    },
  };

  const flush0 = () => {
    if (startNote && o.recorder.ready()) {
      o.recorder.record('server.start', startNote());
      startNote = undefined;
    }
  };

  /** Writes `server.sample` and one `api.window` per group with traffic, then starts a new window. */
  const flush = () => {
    // `server.start` waits for the owner to exist (setup happens after the process starts).
    if (startNote && o.recorder.ready()) {
      o.recorder.record('server.start', startNote());
      startNote = undefined;
    }
    const t = o.now();
    const mem = process.memoryUsage();
    const used = process.cpuUsage(cpu);
    const elapsedMs = Math.max(t - since, 1);
    const f = o.paths();
    const state = o.disk?.state();
    o.recorder.record('server.sample', {
      rss_mb: Math.round(mem.rss / 1048576),
      heap_mb: Math.round(mem.heapUsed / 1048576),
      lag_p95_ms: Math.round(loop.percentile(95) / 1e6),
      lag_max_ms: Math.round(loop.max / 1e6),
      cpu_pct: Math.round(((used.user + used.system) / 1000 / elapsedMs) * 100),
      db_bytes: f.bytes(f.db),
      wal_bytes: f.bytes(`${f.db}-wal`),
      diag_db_bytes: f.bytes(f.diag) + f.bytes(`${f.diag}-wal`),
      disk_free_mb: Math.round((o.disk?.snapshot().freeBytes ?? 0) / 1048576),
      disk_state: state ?? 'ok',
    });
    for (const g of GROUPS) {
      const w = windows.get(g);
      if (!w) continue;
      const sorted = [...w.durations].sort((a, b) => a - b);
      const codes = [...w.codes]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([code, n]) => ({ code, n }));
      o.recorder.record('api.window', {
        group: g,
        n: w.s2xx + w.s4xx + w.s5xx,
        s2xx: w.s2xx,
        s4xx: w.s4xx,
        s5xx: w.s5xx,
        p50_ms: Math.round(pct(sorted, 0.5)),
        p95_ms: Math.round(pct(sorted, 0.95)),
        p99_ms: Math.round(pct(sorted, 0.99)),
        codes,
        ...(g === 'telemetry' && ingest.points_in > 0 ? { ingest: structuredClone(ingest) } : {}),
      });
    }
    windows.clear();
    ingest.points_in = ingest.inserted = ingest.duplicates = 0;
    for (const k of Object.keys(ingest.rejected) as (keyof typeof ingest.rejected)[])
      ingest.rejected[k] = 0;
    loop.reset();
    cpu = process.cpuUsage();
    since = t;
  };

  const job: ModuleJob = {
    name: 'server-metrics',
    start() {
      const unclean = o.markerPath ? existsSync(o.markerPath) : false;
      if (o.markerPath) writeFileSync(o.markerPath, String(o.now()));
      loop.enable();
      startNote = () => ({
        app_v: o.recorder.version,
        schema_v: o.schemaVersion(),
        sqlite_v: o.sqliteVersion(),
        node_v: process.versions.node,
        arch: arch(),
        mem_limit_mb: Math.min(
          1_000_000_000,
          Math.round(Number(process.constrainedMemory?.() || 0) / 1048576),
        ),
        modules: o.modules(),
        unclean_shutdown: unclean,
      });
      flush0();
      const timer = setInterval(flush, o.everyMs ?? 15 * 60_000);
      timer.unref();
      return () => {
        clearInterval(timer);
        loop.disable();
        if (o.markerPath) rmSync(o.markerPath, { force: true });
      };
    },
  };
  return { install, subscriptions, flush, job, observe };
}
export type ServerMetrics = ReturnType<typeof createServerMetrics>;
