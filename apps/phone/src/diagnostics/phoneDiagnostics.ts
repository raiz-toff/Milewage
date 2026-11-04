import {
  crashMessage,
  diagKinds,
  validateEvent,
  type DiagEvent,
  type DiagKind,
  type DiagnosticsPort,
} from '@milewage/shared';
import { gzipSync, strToU8 } from 'fflate';
import { ApiError, type ApiClient } from '../api/client';
import type { CachedSettings, KeyValueStore } from '../pairing/pairing';
import type { UploadStats } from '../upload/worker';

export type DiagLevelSetting = 'off' | 'basic' | 'verbose';

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Records uncaught JS errors as `crash` events, then hands them to the previous handler. */
export function installCrashHandler(
  diag: DiagnosticsPort & {
    recordCrash(e: unknown, fatal: boolean): void;
    persist(): Promise<void>;
  },
  utils: ErrorUtilsLike | undefined,
): void {
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    try {
      diag.recordCrash(error, isFatal === true);
      void diag.persist();
    } finally {
      previous(error, isFatal);
    }
  });
}

/** 16 section 6.3, basic store. */
export const RING_CAP = 8000;
export const BATCH_MAX = 200;
const PROTECTED: ReadonlySet<DiagKind> = new Set([
  'crash',
  'app.start',
  'service.event',
  'engine.run',
  'shift.summary',
  'diag.self',
]);
const DROPPABLE_FIRST: ReadonlySet<DiagKind> = new Set(['track.window', 'upload.window']);

export interface DiagDeps {
  store: KeyValueStore;
  appVersion: string;
  now?: () => number;
  /** True while telemetry is waiting: diagnostics are then not sent (16 section 6.4). */
  telemetryPending?: () => boolean;
}

interface Dropped {
  ring_full: number;
  schema_reject: number;
  level_off: number;
  disk_low: number;
}

const RING_KEY = 'diag.ring';
const STATE_KEY = 'diag.state';

/**
 * Phone-side diagnostics sink (16 section 6). Every event passes `validateEvent` from the shared
 * allowlist before it is stored, so a buggy caller cannot put a field or a coordinate into the
 * ring. A rejected event is counted, never logged and never kept.
 */
export class PhoneDiagnostics implements DiagnosticsPort {
  private ring: DiagEvent[] = [];
  private seq = 0;
  private level: DiagLevelSetting = 'basic';
  private verboseUntil: number | null = null;
  private moduleOn = true;
  private dropped: Dropped = { ring_full: 0, schema_reject: 0, level_off: 0, disk_low: 0 };
  private loaded = false;
  shiftClientId: string | undefined;

  constructor(private readonly d: DiagDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** The level in force now: module off or `off` is nothing; verbose reverts when it expires. */
  get effectiveLevel(): DiagLevelSetting {
    if (!this.moduleOn || this.level === 'off') return 'off';
    if (this.level === 'verbose') {
      return this.verboseUntil !== null && this.now() < this.verboseUntil ? 'verbose' : 'basic';
    }
    return 'basic';
  }

  get size(): number {
    return this.ring.length;
  }

  /** From `GET /settings`: diagnostics level, verbose expiry and the module flag. */
  applySettings(s: Pick<CachedSettings, 'diagnostics' | 'modules'>): void {
    this.moduleOn = s.modules.diagnostics === true;
    this.level = s.diagnostics.level;
    this.verboseUntil = s.diagnostics.verbose_until;
    if (this.effectiveLevel === 'off') this.ring = []; // "unsent local rows are deleted"
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.d.store.get(STATE_KEY);
    if (raw) {
      const st = JSON.parse(raw) as { seq: number; dropped: Dropped };
      this.seq = st.seq;
      this.dropped = st.dropped;
    }
    const ring = await this.d.store.get(RING_KEY);
    if (ring) this.ring = JSON.parse(ring) as DiagEvent[];
  }

  async persist(): Promise<void> {
    await this.d.store.set(RING_KEY, JSON.stringify(this.ring));
    await this.d.store.set(STATE_KEY, JSON.stringify({ seq: this.seq, dropped: this.dropped }));
  }

  record(kind: DiagKind, data: Record<string, unknown>): void {
    const spec = Object.hasOwn(diagKinds, kind) ? diagKinds[kind] : undefined;
    const level = this.effectiveLevel;
    if (
      level === 'off' ||
      ((spec?.level as string | undefined) === 'verbose' && level !== 'verbose')
    ) {
      this.dropped.level_off++;
      return;
    }
    const candidate = {
      kind,
      at: this.now(),
      level: spec?.level ?? 'basic',
      src: 'phone_js',
      seq: this.seq + 1,
      ...(this.shiftClientId && { shift: this.shiftClientId }),
      v: this.d.appVersion,
      data,
    };
    const result = validateEvent(candidate);
    if (!result.ok) {
      this.dropped.schema_reject++; // the reason names a path only; it is not kept either
      return;
    }
    this.seq++;
    this.ring.push(result.event);
    this.enforceCap();
  }

  /** Drop order of 16 section 6.3, simplified to what the JS ring holds. */
  private enforceCap(): void {
    while (this.ring.length > RING_CAP) {
      const order: ((e: DiagEvent) => boolean)[] = [
        (e) => e.level === 'verbose',
        (e) => DROPPABLE_FIRST.has(e.kind),
        (e) => !PROTECTED.has(e.kind),
        () => true,
      ];
      for (const pick of order) {
        const i = this.ring.findIndex(pick);
        if (i >= 0) {
          this.ring.splice(i, 1);
          this.dropped.ring_full++;
          break;
        }
      }
    }
  }

  /** `app.start` once per process start (16 section 3.2). */
  recordAppStart(info: {
    nativeV: string;
    engineV: string;
    apiV: string;
    device: { make: string; model: string; android: string; sdk: number };
  }): void {
    this.record('app.start', {
      app_v: this.d.appVersion,
      native_v: info.nativeV,
      engine_v: info.engineV,
      api_v: info.apiV,
      device: info.device,
    });
  }

  /** `upload.window` from the worker's counters (A7, A8). */
  recordUploadWindow(stats: UploadStats, pendingPoints: number, oldestPendingS: number): void {
    const sorted = [...stats.durations_ms].sort((a, b) => a - b);
    const p95 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
      : 0;
    this.record('upload.window', {
      attempts: stats.attempts,
      ok: stats.ok,
      fail_net: stats.fail_net,
      fail_4xx: stats.fail_4xx,
      fail_5xx: stats.fail_5xx,
      fail_429: stats.fail_429,
      fail_507: stats.fail_507,
      bytes_gz: stats.bytes_gz,
      dur_p95_ms: Math.min(p95, 86_400_000),
      pending_points: pendingPoints,
      oldest_pending_s: oldestPendingS,
    });
  }

  /**
   * `crash` from a JS error. The class must look like an identifier; frames keep only function
   * names; the message is kept only for our own and network classes and then redacted.
   */
  recordCrash(error: unknown, fatal: boolean): void {
    const e = error instanceof Error ? error : new Error(String(error));
    const cls = /^[A-Za-z0-9_.$<>@/:-]{1,120}$/.test(e.name) ? e.name : 'Error';
    const frames = (e.stack ?? '')
      .split('\n')
      .map((line) => /^\s*at\s+([A-Za-z0-9_.$<>]+)/.exec(line)?.[1])
      .filter((f): f is string => !!f)
      .slice(0, 15);
    const msg = crashMessage(cls, e.message);
    this.record('crash', {
      runtime: 'js',
      class: cls,
      frames,
      fatal,
      ...(msg !== undefined && msg.trim() !== '' && { msg }),
    });
  }

  /** `diag.self`: what was dropped and how much is waiting (Q12). */
  recordSelf(): void {
    this.record('diag.self', {
      dropped: { ...this.dropped },
      pending: this.ring.length,
      ring_kb: Math.round(JSON.stringify(this.ring).length / 1024),
      cpu_ms_per_h: 0,
      writes_per_h: 0,
    });
  }

  /** Test and export view of what is stored. */
  snapshot(): readonly DiagEvent[] {
    return this.ring;
  }

  /**
   * Sends up to 200 events with the device credential. Skipped when telemetry is waiting or the
   * level is off. 200 deletes what was sent; 404 means the module is off on the server (behave as
   * off); 422 drops the batch's bad events by index; anything retryable keeps the ring.
   */
  async flush(client: ApiClient): Promise<'sent' | 'skipped' | 'retry' | 'module_off'> {
    if (this.effectiveLevel === 'off' || this.ring.length === 0) return 'skipped';
    if (this.d.telemetryPending?.()) return 'skipped';
    const events = this.ring.slice(0, BATCH_MAX);
    try {
      const res = await client.request<{ rejected: { index: number }[] }>(
        'POST',
        '/diagnostics/events',
        undefined,
        { 'Content-Encoding': 'gzip' },
        gzipSync(strToU8(JSON.stringify({ events }))),
      );
      // Accepted, duplicates and rejected events are all finished: none is sent again.
      this.dropped.schema_reject += res.data.rejected?.length ?? 0;
      this.ring.splice(0, events.length);
      await this.persist();
      return 'sent';
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 404) {
        this.moduleOn = false;
        this.ring = [];
        await this.persist();
        return 'module_off';
      }
      if (e.status === 422 || (e.status === 413 && events.length === 1)) {
        this.ring.splice(0, events.length);
        this.dropped.schema_reject += events.length;
        await this.persist();
        return 'sent';
      }
      return 'retry';
    }
  }
}
