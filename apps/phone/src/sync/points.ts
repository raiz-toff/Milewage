import { ApiError } from '../api/client';
import type { ApiClient } from '../api/client';
import type { DeviceSession } from '../pairing/deviceSession';
import type { Flags } from '../pairing/pairing';
import { PUMP_LIMIT, type PointFeed } from '../shift/feed';
import { encode, halvedBatch, send } from './shiftRequests';
import type { Tracker, TrackerPoint } from '../tracker/types';

/*
 * Internal to the sender (`sender.ts`): the shift's points in batches. Nothing outside `sync/`
 * imports this file except for the `UploadStats` type the diagnostics window reports.
 */

/** 08 section 4.2 rules 5 and 7, section 5. */
export const LIVE_BATCH = 100;
export const BACKLOG_BATCH = 500;
/** The server's hard maximum; no request ever carries more. */
export const MAX_BATCH = 500;
export const BACKOFF_S = [2, 4, 8, 16, 32, 60] as const;
export const DEFAULT_INTERVAL_S = 60;
const LOCAL_RAW_DAYS = 14;
const NOT_FOUND_ATTEMPTS = 3;

export type UploadState =
  | 'idle'
  | 'backoff'
  | 'waiting_create'
  | 'parked'
  /** The device session stops sending (revoked, wrong server, sign-in problem). */
  | 'halted'
  | 'not_paired'
  | 'tracking_off'
  | 'cancelled';

/** What a drain may be told (the sender's backlog round uses all of it). */
export interface DrainOptions {
  /** Only this shift's points. */
  shift?: string;
  /** First batch size; 100 for live uploads, 500 for a backlog (15 section 6.3). */
  size?: number;
  /** Stop after this many accepted batches, so the caller can look at the live shift in between. */
  maxBatches?: number;
  /** Checked before every request; true ends the drain with `cancelled`. Nothing needs cleaning up. */
  shouldStop?: () => boolean;
}

export interface DrainResult {
  state: UploadState;
  uploaded: number;
  rejected: number;
  /** When to call `drain` again; null when nothing is pending or the worker is halted. */
  retryInMs: number | null;
}

/** Counters for the `upload.window` diagnostics event (16 section 3.2); read and reset by M4.9. */
export interface UploadStats {
  attempts: number;
  ok: number;
  fail_net: number;
  fail_4xx: number;
  fail_5xx: number;
  fail_429: number;
  fail_507: number;
  bytes_gz: number;
  durations_ms: number[];
}

const emptyStats = (): UploadStats => ({
  attempts: 0,
  ok: 0,
  fail_net: 0,
  fail_4xx: 0,
  fail_5xx: 0,
  fail_429: 0,
  fail_507: 0,
  bytes_gz: 0,
  durations_ms: [],
});

/** 2, 4, 8, 16, 32, then 60 s, each with +-20% jitter; a success resets it. */
export class Backoff {
  private step = 0;
  constructor(private readonly rand: () => number = Math.random) {}
  next(retryAfterS: number | null = null): number {
    if (retryAfterS !== null) {
      this.step = Math.min(this.step + 1, BACKOFF_S.length);
      return retryAfterS * 1000;
    }
    const base = BACKOFF_S[Math.min(this.step, BACKOFF_S.length - 1)]! * 1000;
    this.step = Math.min(this.step + 1, BACKOFF_S.length);
    return Math.round(base * (0.8 + 0.4 * this.rand()));
  }
  reset(): void {
    this.step = 0;
  }
}

export interface PointsDeps {
  tracker: Tracker;
  feed: PointFeed;
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  /** The device session: nothing is sent while it is halted; its `resume` starts the worker clean. */
  device: Pick<DeviceSession, 'halted' | 'subscribe'>;
  /** Has `POST /shifts` for this shift been acknowledged (08 section 4.2 rule 2)? */
  shiftReady: (clientId: string) => boolean | Promise<boolean>;
  /** The shift's create was refused for good: park its points instead of waiting for it. */
  shiftParked: (clientId: string) => boolean | Promise<boolean>;
  /** True while eviction must not run (the server was restored from a backup, 15 section 3.2). */
  evictBlocked: () => boolean;
  /** Sends the queued changes (shift create, odometer, end); called on 404 `shift_not_found`. */
  flushQueue: () => Promise<unknown>;
  now?: () => number;
  rand?: () => number;
}

interface WireBatch {
  inserted: number;
  duplicates: number;
  rejected: { seq: number; code: string }[];
  upload_hint_s?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Sends the points still pending on the phone, oldest shift first (08 section 4.2, 4.3): gzip
 * batches of 100 for the running shift and 500 for a backlog, never more than 500; 413 and 422
 * halve the batch; a point the server refuses is set aside, never deleted; a shift the server does
 * not know is tried 3 times, then its points are set aside until the session resumes.
 */
export class PointUploader {
  private readonly now: () => number;
  private readonly backoff: Backoff;
  private notFound = new Map<string, number>();
  private parked = new Set<string>();
  private busy = false;
  private hintS = DEFAULT_INTERVAL_S;
  private stats = emptyStats();
  /** How the last drain ended; `backoff` and `waiting_create` are "offline" on the banner. */
  lastState: UploadState = 'idle';

  constructor(private readonly d: PointsDeps) {
    this.now = d.now ?? Date.now;
    this.backoff = new Backoff(d.rand);
    d.device.subscribe(() => void this.d.device.halted().then((h) => h === null && this.unpark()));
  }

  /** Seconds between uploads while a shift is running: 60, or the server's hint clamped to 10-300. */
  get intervalMs(): number {
    return this.hintS * 1000;
  }

  takeStats(): UploadStats {
    const s = this.stats;
    this.stats = emptyStats();
    return s;
  }

  /**
   * Forgets the shifts whose points were set aside, so they are tried again: after the device
   * session resumes (a new pairing) and after a restored server got a shift again.
   */
  unpark(): void {
    this.parked.clear();
    this.notFound.clear();
    this.backoff.reset();
  }

  /** Uploads everything pending, oldest shift first, until empty, halted or a retryable failure. */
  async drain(opts: DrainOptions = {}): Promise<DrainResult> {
    if (this.busy) return { state: this.lastState, uploaded: 0, rejected: 0, retryInMs: null };
    this.busy = true;
    try {
      return await this.run(opts);
    } finally {
      this.busy = false;
    }
  }

  private done(state: UploadState, uploaded: number, rejected: number, retryInMs: number | null) {
    this.lastState = state;
    return { state, uploaded, rejected, retryInMs };
  }

  private async run(opts: DrainOptions): Promise<DrainResult> {
    let uploaded = 0;
    let rejected = 0;
    let batches = 0;
    let size = opts.size ?? LIVE_BATCH;
    for (;;) {
      if (opts.shouldStop?.()) return this.done('cancelled', uploaded, rejected, null);
      if (opts.maxBatches !== undefined && batches >= opts.maxBatches) {
        return this.done('idle', uploaded, rejected, null);
      }
      const session = await this.d.session();
      if (!session) return this.done('not_paired', uploaded, rejected, null);
      if (!session.flags.tracking) return this.done('tracking_off', uploaded, rejected, null);
      if (await this.d.device.halted()) return this.done('halted', uploaded, rejected, null);

      const pending = this.d.feed
        .readPending(PUMP_LIMIT)
        .filter(
          (p) =>
            !this.parked.has(p.shiftClientId) && (!opts.shift || p.shiftClientId === opts.shift),
        );
      if (pending.length === 0) {
        if (!this.d.evictBlocked())
          this.d.tracker.evictUploaded(this.now() - LOCAL_RAW_DAYS * 86_400_000);
        const parked = this.parked.size > 0;
        return this.done(parked ? 'parked' : 'idle', uploaded, rejected, null);
      }
      const shiftId = pending[0]!.shiftClientId;
      if (!(await this.d.shiftReady(shiftId))) {
        await this.d.flushQueue();
        if (await this.d.shiftParked(shiftId)) {
          this.parked.add(shiftId); // never dropped; the driver sees the shift needs attention
          continue;
        }
        if (!(await this.d.shiftReady(shiftId))) {
          return this.done('waiting_create', uploaded, rejected, this.backoff.next());
        }
      }
      const mine = pending.filter((p) => p.shiftClientId === shiftId);
      if (size === LIVE_BATCH && mine.length > BACKLOG_BATCH) size = BACKLOG_BATCH;
      const batch = mine.slice(0, clamp(size, 1, MAX_BATCH));

      try {
        const res = await this.send(session.client, shiftId, batch);
        const bad = new Set(res.rejected.map((r) => r.seq));
        const good = batch.filter((p) => !bad.has(p.seq)).map((p) => p.seq);
        this.d.tracker.markUploaded(good);
        if (bad.size > 0) this.d.tracker.markRejected([...bad]);
        uploaded += good.length;
        rejected += bad.size;
        batches++;
        this.backoff.reset();
        this.notFound.delete(shiftId);
        this.hintS = clamp(res.upload_hint_s ?? DEFAULT_INTERVAL_S, 10, 300);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        const out = await this.onError(e, shiftId, batch);
        if (out.kind === 'halve') {
          size = out.size;
        } else if (out.kind === 'retry') {
          return this.done('backoff', uploaded, rejected, out.delayMs);
        } else if (out.kind === 'halt') {
          return this.done('halted', uploaded, rejected, null);
        } else {
          rejected += out.rejected;
        }
      }
    }
  }

  private async send(
    client: ApiClient,
    shiftId: string,
    batch: TrackerPoint[],
  ): Promise<WireBatch> {
    const req = encode({ type: 'telemetry.batch', clientId: shiftId, points: batch });
    this.stats.attempts++;
    this.stats.bytes_gz += req.gzip.length;
    const t0 = this.now();
    try {
      const res = await send<WireBatch>(client, req);
      this.stats.ok++;
      this.stats.durations_ms.push(this.now() - t0);
      return res.data;
    } catch (e) {
      this.stats.durations_ms.push(this.now() - t0);
      if (e instanceof ApiError) this.count(e);
      throw e;
    }
  }

  private count(e: ApiError): void {
    if (e.status === 0) this.stats.fail_net++;
    else if (e.status === 429) this.stats.fail_429++;
    else if (e.status === 507) this.stats.fail_507++;
    else if (e.status >= 500) this.stats.fail_5xx++;
    else this.stats.fail_4xx++;
  }

  /** 08 section 4.3, row by row. */
  private async onError(
    e: ApiError,
    shiftId: string,
    batch: TrackerPoint[],
  ): Promise<
    | { kind: 'halve'; size: number }
    | { kind: 'retry'; delayMs: number }
    | { kind: 'halt' }
    | { kind: 'rejected'; rejected: number }
  > {
    const seqs = batch.map((p) => p.seq);
    if (await this.d.device.halted()) return { kind: 'halt' };
    if (e.status === 404 && e.code === 'shift_not_found') {
      const n = (this.notFound.get(shiftId) ?? 0) + 1;
      this.notFound.set(shiftId, n);
      await this.d.flushQueue();
      if (n >= NOT_FOUND_ATTEMPTS && (await this.d.shiftReady(shiftId))) {
        this.parked.add(shiftId); // the server still does not know it: park, never drop
        return { kind: 'rejected', rejected: 0 };
      }
      return { kind: 'retry', delayMs: this.backoff.next() };
    }
    if (e.status === 409 && e.code === 'shift_finalized') {
      return { kind: 'rejected', rejected: this.d.tracker.markRejected(seqs) };
    }
    const smaller = halvedBatch(e, batch.length);
    if (smaller !== null) return { kind: 'halve', size: smaller };
    if (e.status === 422) {
      return { kind: 'rejected', rejected: this.d.tracker.markRejected(seqs) };
    }
    return { kind: 'retry', delayMs: this.backoff.next(e.retryAfterS) };
  }
}
