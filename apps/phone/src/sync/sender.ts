import type { ApiClient } from '../api/client';
import type { AppSqlDb } from '../db/appDb';
import type { DeviceSession, HaltReason } from '../pairing/deviceSession';
import type { CachedSettings, Flags } from '../pairing/pairing';
import { PUMP_LIMIT, type PointFeed } from '../shift/feed';
import type { ServerRecon, ServerShift, ShiftStore } from '../store/shiftStore';
import type { Tracker } from '../tracker/types';
import type { ConnectionMonitor } from './connection';
import { shiftOf, type Outbox, type OutboxItem } from './outbox';
import { BACKLOG_BATCH, PointUploader, type UploadStats } from './points';
import { ChangePuller } from './pull';
import { RestoreResend } from './resend';
import { OutboxRunner, type RunResult, type Sent } from './runner';
import { buildStatus, storageState, type SyncStatus } from './status';

/**
 * The shift being recorded, as far as sending needs it. The shift controller is this: it owns the
 * running shift's create (the driver decides when the server already has an active shift), so
 * the sender asks it to send that create and never sends the running shift's points before it.
 */
export interface Recorder {
  readonly current: { clientId: string; endedAt: number | null; created: boolean } | null;
  /**
   * Finishes a hand-off that was cut short (the app was killed after "End shift") and sends the
   * running shift's create and start odometer. True when none of that is left to send.
   */
  sendRunning(): Promise<boolean>;
}

/** The send round in progress, or the last one, for the progress line on the home screen. */
export interface Progress {
  phase: 'idle' | 'running' | 'done' | 'cancelled' | 'waiting' | 'halted';
  pointsSent: number;
  /** Pending points when the round started: exact below 10,000, otherwise the sum of the shifts' manifests. */
  pointsTotal: number;
  shiftsDone: number;
  shiftsTotal: number;
  startedAt: number | null;
}

/** The one status the screens show: the banner's numbers and sentence, the halt and the progress. */
export interface SendStatus extends SyncStatus {
  /** Why the device session stopped sending (revoked, wrong server, sign-in problem); null when it did not. */
  halt: HaltReason | null;
  progress: Progress;
}

/**
 * Sending to the server (15 section 6): everything the phone has that the server does not, in the
 * order the server needs it. Three callers: the screens (`sendNow`, `retry`, `cancel`, `status`,
 * `subscribe`), the app lifecycle (`start`, `stop`) and the diagnostics window (`takeUploadStats`).
 * The shift controller and the phone edits never call it: they write to the queue it sends from.
 *
 * Behind it: the queue (`outbox.ts`) in order with the `shift.end` barrier (an end waits for the
 * shift's last point), the points in batches of 100 or 500 halved on 413/422 (`points.ts`),
 * retries with backoff, what the server's end answer changes on the phone, sending again after a
 * restore (`resend.ts`), and reading the change log once everything went (`pull.ts`). Nothing is
 * sent while the device session is halted, and nothing on the phone is ever dropped.
 */
export interface Sender {
  /**
   * One round now; returns once it is over (a round already running is waited for, then one more
   * runs). True when nothing is left on the phone only: no queued change and the running shift's
   * create and start odometer acknowledged. False offline, halted, cancelled or with a change the
   * server refused.
   */
  sendNow(): Promise<boolean>;
  /**
   * The driver's "Send now" and "Check the address": lifts every halt of the device session, then
   * a round that reads the change log too. A server that still refuses halts it again.
   */
  retry(): Promise<boolean>;
  /** Stops the round between two requests ("Stop sending"). Nothing needs cleaning up. */
  cancel(): void;
  status(): Promise<SendStatus>;
  /** Told when the progress or the device session's halt changes; read `status` then. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** Rounds now and then again on the server's hint (60 s, 10-300 s) or the retry delay, until `stop`. */
  start(): void;
  stop(): void;
  /** Point upload counters since the last call, for the `upload.window` diagnostics event. */
  takeUploadStats(): UploadStats;
}

export interface SenderDeps {
  db: AppSqlDb;
  /** What the shift controller and the edits queued; only the sender takes from it. */
  queue: Outbox;
  store: ShiftStore;
  tracker: Tracker;
  feed: PointFeed;
  recorder: Recorder;
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  device: DeviceSession;
  /** Instance and restore-generation checks; it writes what a restore asks to send again. */
  monitor: ConnectionMonitor;
  /** `GET /settings` first: it reveals a wrong server before any data is sent (15 section 6.2 step 1). */
  handshake?: () => Promise<unknown>;
  /** The server's settings arrived through the change log. */
  onSettings?: (s: CachedSettings) => void | Promise<void>;
  /** Free device storage in bytes, for the banner; null when it cannot be read. */
  freeBytes?: () => Promise<number | null>;
  now?: () => number;
  rand?: () => number;
}

export type { UploadStats };

export function createSender(d: SenderDeps): Sender {
  return new ShiftSender(d);
}

interface Round {
  state: 'idle' | 'cancelled' | 'offline' | 'halted';
  /** When to try again after a retryable failure; null otherwise. */
  retryInMs: number | null;
  /** Nothing is left on the phone only (see `sendNow`). */
  done: boolean;
}

const IDLE: Progress = {
  phase: 'idle',
  pointsSent: 0,
  pointsTotal: 0,
  shiftsDone: 0,
  shiftsTotal: 0,
  startedAt: null,
};

class ShiftSender implements Sender {
  private readonly now: () => number;
  private readonly runner: OutboxRunner;
  private readonly points: PointUploader;
  private readonly resend: RestoreResend;
  private readonly puller: ChangePuller;
  private readonly listeners = new Set<() => void>();
  private progress: Progress = IDLE;
  /** How the last round ended: `offline` shows "Offline. Saved on your phone." on the banner. */
  private last: Round['state'] = 'idle';
  private cancelled = false;
  private running: Promise<Round> | null = null;
  private next: Promise<Round> | null = null;
  private nextForced = false;
  private skipNext = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by `start` and `stop`, so a round still in flight from an old loop schedules nothing. */
  private loop = 0;

  constructor(private readonly d: SenderDeps) {
    this.now = d.now ?? Date.now;
    const { db, queue, store, tracker, feed, session, device, monitor, now, rand } = d;
    this.runner = new OutboxRunner({
      outbox: queue,
      session,
      device,
      rand,
      canSend: (item) => this.canSend(item),
      onSent: (sent) => this.onSent(sent),
      onParked: (item) => store.setSyncState(shiftOf(item.entityKey), 'needs_attention'),
    });
    this.resend = new RestoreResend({
      db,
      store,
      outbox: queue,
      runner: this.runner,
      tracker,
      feed,
      monitor,
      session,
      device,
      now,
      rand,
    });
    this.points = new PointUploader({
      tracker,
      feed,
      session,
      device,
      shiftReady: (id) => this.created(id),
      shiftParked: (id) => this.createParked(id),
      evictBlocked: () => monitor.restored || this.resend.blocksEviction(),
      flushQueue: async () => {
        await d.recorder.sendRunning();
        await this.runner.run();
      },
      now,
      rand,
    });
    this.puller = new ChangePuller({
      db,
      outbox: queue,
      session,
      device,
      onSettings: d.onSettings,
      now,
    });
    device.subscribe(() => this.changed());
  }

  sendNow(): Promise<boolean> {
    return this.round(false).then((r) => r.done);
  }

  async retry(): Promise<boolean> {
    await this.d.device.resume();
    return (await this.round(true)).done;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.next) this.skipNext = true;
  }

  async status(): Promise<SendStatus> {
    const progress = this.progress;
    await this.d.monitor.settled();
    const counts = await this.d.queue.counts();
    const halt = await this.d.device.halted();
    const state = this.points.lastState;
    return {
      ...buildStatus({
        shifts: await this.d.store.list(),
        parkedItems: counts.parked,
        oldestQueuedAt: counts.oldestAt,
        wrongServer: halt === 'wrong_server',
        restored: this.d.monitor.restored || (await this.resend.waiting()),
        halted: halt === 'wrong_server' ? null : halt,
        offline: this.last === 'offline' || state === 'backoff' || state === 'waiting_create',
        storage: storageState((await this.d.freeBytes?.()) ?? null),
      }),
      halt,
      progress,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  start(): void {
    if (this.timer !== null) return;
    const loop = ++this.loop;
    const tick = async () => {
      const r = await this.round(false).catch(() => null);
      if (loop !== this.loop) return;
      this.timer = setTimeout(() => void tick(), r?.retryInMs ?? this.points.intervalMs);
    };
    this.timer = setTimeout(() => void tick(), 0);
  }

  stop(): void {
    this.loop++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  takeUploadStats(): UploadStats {
    return this.points.takeStats();
  }

  /** One round at a time; a call during a round gets one more round after it (forced if any caller asked). */
  private round(force: boolean): Promise<Round> {
    if (!this.running) {
      this.running = this.run(force)
        .then((r) => {
          this.last = r.state;
          return r;
        })
        .finally(() => {
          this.running = null;
        });
      return this.running;
    }
    this.nextForced ||= force;
    this.next ??= this.running
      .catch(() => undefined)
      .then(() => {
        this.next = null;
        const forced = this.nextForced;
        this.nextForced = false;
        if (this.skipNext) {
          this.skipNext = false;
          return { state: 'cancelled', retryInMs: null, done: false } as Round;
        }
        return this.round(forced);
      });
    return this.next;
  }

  private changed() {
    for (const fn of [...this.listeners]) fn();
  }

  private set(p: Partial<Progress>) {
    this.progress = { ...this.progress, ...p };
    this.changed();
  }

  private stopped = () => this.cancelled;

  /** The running shift's client id; null when none runs (an ended one waiting for its hand-off included). */
  private liveId(): string | null {
    const c = this.d.recorder.current;
    return c && c.endedAt === null ? c.clientId : null;
  }

  /** Has `POST /shifts` of this shift been acknowledged (08 section 4.2 rule 2)? */
  private async created(id: string): Promise<boolean> {
    const c = this.d.recorder.current;
    if (c?.clientId === id) return c.created;
    return !(await this.d.queue.has('shift.create', id));
  }

  /** The shift's create was refused for good: its points must not block other shifts. */
  private async createParked(id: string): Promise<boolean> {
    return (await this.d.queue.parked()).some(
      (i) => i.kind === 'shift.create' && i.entityKey === id,
    );
  }

  /**
   * `shift.end` waits until every point of the shift is uploaded or set aside (15 section 6.2).
   * After a restore nothing of a shift goes out before the server has it again (15 section 9.3).
   */
  private async canSend(item: OutboxItem): Promise<boolean> {
    const id = shiftOf(item.entityKey);
    if (await this.resend.holds(id)) return false;
    return (
      item.kind !== 'shift.end' ||
      !this.d.feed.readPending(PUMP_LIMIT).some((p) => p.shiftClientId === id)
    );
  }

  /** The server's answer to `end` replaces the phone's numbers; the shift is "on server". */
  private async onSent({ item, outcome, response }: Sent): Promise<void> {
    if (item.kind !== 'shift.end') return;
    const id = shiftOf(item.entityKey);
    const body = response?.data as (ServerShift & { recon?: ServerRecon }) | undefined;
    if (outcome === 'sent' && typeof body?.id === 'number') {
      await this.d.store.applyEnd(id, body, body.recon ?? null);
    } else {
      await this.d.store.setSyncState(id, 'on_server');
    }
  }

  /**
   * One round (15 section 6.2, 6.4): the settings first, then what a restore lost, then the
   * running shift, then the ended shifts oldest first, each as create and odometer readings, all
   * of its points in batches of 500, then `shift.end`. After every backlog batch the running
   * shift's points go first when they are older than the server's upload hint. Then the edits of
   * shifts already on the server, and the change log. State lives in the databases, not here: a
   * cancelled or failed round is simply picked up by the next one.
   */
  private async run(force: boolean): Promise<Round> {
    this.cancelled = false;
    await this.d.handshake?.();
    const open = await this.closeOpen();
    if (open) {
      this.set({ phase: open.state === 'offline' ? 'waiting' : open.state });
      return open;
    }
    const again = await this.resendAfterRestore();
    if (again.state !== 'idle') {
      this.set({ phase: again.state === 'offline' ? 'waiting' : again.state });
      return { state: again.state, retryInMs: again.retryInMs, done: false };
    }
    const liveOk = await this.serveRunning();
    const todo = await this.unsynced();
    const pending = this.d.feed.readPending(PUMP_LIMIT);
    const total =
      pending.length < PUMP_LIMIT
        ? pending.length
        : (await Promise.all(todo.map((id) => this.d.store.get(id)))).reduce(
            (a, r) => a + (r?.point_count ?? 0),
            0,
          );
    this.set({
      phase: 'running',
      pointsSent: 0,
      pointsTotal: total,
      shiftsDone: again.shifts,
      shiftsTotal: todo.length + again.shifts,
      startedAt: this.now(),
    });

    const visited = new Set<string>();
    for (
      let ids = todo;
      ids.length > 0;
      ids = (await this.unsynced()).filter((i) => !visited.has(i))
    ) {
      for (const id of ids) {
        visited.add(id);
        const stop = await this.oneShift(id);
        if (stop) {
          this.set({ phase: stop.state === 'offline' ? 'waiting' : stop.state });
          return stop;
        }
        this.set({ shiftsDone: this.progress.shiftsDone + 1 });
      }
    }
    // Edits and readings of shifts that are already on the server, and anything left over.
    const rest = this.stopFor(await this.runner.run());
    if (rest) {
      this.set({ phase: rest.state === 'offline' ? 'waiting' : 'halted' });
      return rest;
    }
    await this.resend.settle();
    this.set({ phase: 'done' });
    const sent = this.progress.pointsSent > 0 || this.progress.shiftsDone > 0;
    await this.puller.pull({ force: force || sent });
    const c = await this.d.queue.counts();
    return { state: 'idle', retryInMs: null, done: liveOk && c.pending === 0 && c.parked === 0 };
  }

  /** Ended shifts with work left (queued changes or pending points), oldest first, never the running one. */
  private async unsynced(): Promise<string[]> {
    const { store, queue, feed } = this.d;
    const live = this.liveId();
    const ids = new Set<string>();
    for (const p of feed.readPending(PUMP_LIMIT)) ids.add(p.shiftClientId);
    for (const i of await queue.pending()) ids.add(shiftOf(i.entityKey));
    for (const i of await queue.parked()) ids.delete(shiftOf(i.entityKey));
    for (const id of await this.resend.held()) ids.delete(id);
    if (live) ids.delete(live);
    const rows = await Promise.all([...ids].map(async (id) => [id, await store.get(id)] as const));
    return rows
      .sort((a, b) => (a[1]?.started_at ?? Infinity) - (b[1]?.started_at ?? Infinity))
      .map(([id]) => id);
  }

  /**
   * The server keeps one active shift. A shift it holds open (its create acknowledged, its end
   * still queued: the driver just ended it) is closed first, so a shift created after it, sent
   * again after a restore for one, is not refused with 409 `shift_already_active`. Its end still
   * waits for its points.
   */
  private async closeOpen(): Promise<Round | null> {
    const { queue } = this.d;
    for (const item of await queue.pending()) {
      if (item.kind !== 'shift.end') continue;
      const id = shiftOf(item.entityKey);
      if (await queue.has('shift.create', id)) continue;
      const stop = this.stopFor(await this.runner.run({ shift: id }));
      if (stop) return stop;
    }
    return null;
  }

  /**
   * After a restore: the shifts the server once had, sent again before anything else. A shift
   * created again may have had its points set aside meanwhile (404), so the points start clean.
   */
  private async resendAfterRestore() {
    const r = await this.resend.run({ live: this.liveId(), shouldStop: this.stopped });
    if (r.recreated) this.points.unpark();
    return r;
  }

  /**
   * What the recorder still owns of sending (a cut-short hand-off, the running shift's create and
   * start odometer), then the running shift's points in batches of at most 100.
   */
  private async serveRunning(): Promise<boolean> {
    if (!this.d.recorder.current) return true;
    const ok = await this.d.recorder.sendRunning();
    const live = this.liveId();
    if (live) await this.points.drain({ shift: live, shouldStop: this.stopped });
    return ok;
  }

  private runningIsDue(): boolean {
    const live = this.liveId();
    if (!live) return false;
    const cutoff = this.now() - this.points.intervalMs;
    return this.d.feed
      .readPending(PUMP_LIMIT)
      .some((p) => p.shiftClientId === live && p.recordedAt <= cutoff);
  }

  /** One ended shift: create and readings, all points, then the end. Returns the round's end to stop it. */
  private async oneShift(id: string): Promise<Round | null> {
    const halt = this.stopFor(await this.runner.run({ shift: id }));
    if (halt) return halt;
    for (;;) {
      if (this.cancelled) return { state: 'cancelled', retryInMs: null, done: false };
      const u = await this.points.drain({
        shift: id,
        size: BACKLOG_BATCH,
        maxBatches: 1,
        shouldStop: this.stopped,
      });
      this.set({ pointsSent: this.progress.pointsSent + u.uploaded + u.rejected });
      if (u.state === 'cancelled') return { state: 'cancelled', retryInMs: null, done: false };
      if (u.state === 'backoff' || u.state === 'waiting_create') {
        return { state: 'offline', retryInMs: u.retryInMs, done: false };
      }
      if (u.state === 'halted') return { state: 'halted', retryInMs: null, done: false };
      if (u.uploaded + u.rejected === 0) break;
      if (this.runningIsDue()) await this.serveRunning();
    }
    return this.stopFor(await this.runner.run({ shift: id }));
  }

  private stopFor(r: RunResult): Round | null {
    if (r.state === 'offline') return { state: 'offline', retryInMs: r.retryInMs, done: false };
    if (r.state === 'halted') return { state: 'halted', retryInMs: null, done: false };
    return null;
  }
}
