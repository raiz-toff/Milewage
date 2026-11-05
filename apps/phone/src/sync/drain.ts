import type { PointFeed } from '../shift/feed';
import { PUMP_LIMIT } from '../shift/feed';
import type { ShiftController } from '../shift/controller';
import type { ShiftStore } from '../store/shiftStore';
import { BACKLOG_BATCH, type UploadWorker } from '../upload/worker';
import { shiftOf, type Outbox } from './outbox';
import type { OutboxRunner } from './runner';

export interface Progress {
  phase: 'idle' | 'running' | 'done' | 'cancelled' | 'waiting' | 'halted';
  pointsSent: number;
  /** Pending points when the drain started: exact below 10,000, otherwise the sum of the shifts' manifests. */
  pointsTotal: number;
  shiftsDone: number;
  shiftsTotal: number;
  startedAt: number | null;
}

export interface DrainSummary {
  state: 'idle' | 'busy' | 'cancelled' | 'offline' | 'halted';
  /** When to try again after a retryable failure; null otherwise. */
  retryInMs: number | null;
}

export interface DrainDeps {
  store: ShiftStore;
  outbox: Outbox;
  runner: OutboxRunner;
  uploader: UploadWorker;
  feed: PointFeed;
  controller: ShiftController;
  now?: () => number;
}

const IDLE: Progress = {
  phase: 'idle',
  pointsSent: 0,
  pointsTotal: 0,
  shiftsDone: 0,
  shiftsTotal: 0,
  startedAt: null,
};

/**
 * The backlog drain (15 section 6.2, 6.4). Shifts go oldest first and each one as create and
 * odometer readings, then all of its telemetry in batches of 500, then `shift.end` (the runner's
 * barrier holds it until the last point is acknowledged). After every backlog batch the running
 * shift's points go first when they are older than the server's upload hint, so the live map on
 * the web keeps moving while weeks of history drain. State lives in the databases, not here:
 * `cancel` stops between requests, and the next drain simply finds what is still pending.
 */
export class SyncDrain {
  private busy = false;
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(p: Progress) => void>();
  private state: Progress = IDLE;
  private readonly now: () => number;

  constructor(private readonly d: DrainDeps) {
    this.now = d.now ?? Date.now;
  }

  get progress(): Progress {
    return this.state;
  }

  subscribe(fn: (p: Progress) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Drains now, then again on the server's hint (or the retry delay) until `stop`. */
  start(): void {
    if (this.timer !== null) return;
    const tick = async () => {
      const r = await this.drain();
      this.timer = setTimeout(() => void tick(), r.retryInMs ?? this.d.uploader.intervalMs);
    };
    this.timer = setTimeout(() => void tick(), 0);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async drain(): Promise<DrainSummary> {
    if (this.busy) return { state: 'busy', retryInMs: null };
    this.busy = true;
    this.cancelled = false;
    try {
      return await this.run();
    } finally {
      this.busy = false;
    }
  }

  private set(p: Partial<Progress>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  private stopped = () => this.cancelled;

  private async run(): Promise<DrainSummary> {
    const { store, runner } = this.d;
    await this.serveRunning();
    const todo = await this.unsynced();
    const pending = this.d.feed.readPending(PUMP_LIMIT);
    const total =
      pending.length < PUMP_LIMIT
        ? pending.length
        : (await Promise.all(todo.map((id) => store.get(id)))).reduce(
            (a, r) => a + (r?.point_count ?? 0),
            0,
          );
    this.set({
      phase: 'running',
      pointsSent: 0,
      pointsTotal: total,
      shiftsDone: 0,
      shiftsTotal: todo.length,
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
          this.set({
            phase:
              stop.state === 'cancelled'
                ? 'cancelled'
                : stop.state === 'halted'
                  ? 'halted'
                  : 'waiting',
          });
          return stop;
        }
        this.set({ shiftsDone: this.state.shiftsDone + 1 });
      }
    }
    // Edits and readings of shifts that are already on the server, and anything left over.
    const rest = await runner.run();
    if (rest.state === 'offline') {
      this.set({ phase: 'waiting' });
      return { state: 'offline', retryInMs: rest.retryInMs };
    }
    if (rest.state === 'repair' || rest.state === 'auth_problem') {
      this.set({ phase: 'halted' });
      return { state: 'halted', retryInMs: null };
    }
    this.set({ phase: 'done' });
    return { state: 'idle', retryInMs: null };
  }

  /** Ended shifts with work left (queued requests or pending points), oldest first, never the running one. */
  private async unsynced(): Promise<string[]> {
    const { store, outbox, feed, controller } = this.d;
    const live = controller.current?.endedAt === null ? controller.current.clientId : null;
    const ids = new Set<string>();
    for (const p of feed.readPending(PUMP_LIMIT)) ids.add(p.shiftClientId);
    for (const i of await outbox.pending()) ids.add(shiftOf(i.entityKey));
    for (const i of await outbox.parked()) ids.delete(shiftOf(i.entityKey));
    if (live) ids.delete(live);
    const rows = await Promise.all([...ids].map(async (id) => [id, await store.get(id)] as const));
    return rows
      .sort((a, b) => (a[1]?.started_at ?? Infinity) - (b[1]?.started_at ?? Infinity))
      .map(([id]) => id);
  }

  /** The running shift: its create and odometer, then its points (batches of at most 100). */
  private async serveRunning(): Promise<void> {
    const live = this.d.controller.current;
    if (!live || live.endedAt !== null) return;
    await this.d.controller.syncRunning();
    await this.d.uploader.drain({ shift: live.clientId, shouldStop: this.stopped });
  }

  private runningIsDue(): boolean {
    const live = this.d.controller.current;
    if (!live || live.endedAt !== null) return false;
    const cutoff = this.now() - this.d.uploader.intervalMs;
    return this.d.feed
      .readPending(PUMP_LIMIT)
      .some((p) => p.shiftClientId === live.clientId && p.recordedAt <= cutoff);
  }

  /** One ended shift: create and readings, all points, then the end. Returns a summary to stop the drain. */
  private async oneShift(id: string): Promise<DrainSummary | null> {
    const { runner, uploader } = this.d;
    const before = await runner.run({ shift: id });
    const halt = this.halt(before);
    if (halt) return halt;
    for (;;) {
      if (this.cancelled) return { state: 'cancelled', retryInMs: null };
      const u = await uploader.drain({
        shift: id,
        size: BACKLOG_BATCH,
        maxBatches: 1,
        shouldStop: this.stopped,
      });
      this.set({ pointsSent: this.state.pointsSent + u.uploaded + u.rejected });
      if (u.state === 'cancelled') return { state: 'cancelled', retryInMs: null };
      if (u.state === 'backoff' || u.state === 'waiting_create') {
        return { state: 'offline', retryInMs: u.retryInMs };
      }
      if (u.state === 'repair' || u.state === 'auth_problem')
        return { state: 'halted', retryInMs: null };
      if (u.uploaded + u.rejected === 0) break;
      if (this.runningIsDue()) await this.serveRunning();
    }
    return this.halt(await runner.run({ shift: id }));
  }

  private halt(r: Awaited<ReturnType<OutboxRunner['run']>>): DrainSummary | null {
    if (r.state === 'offline') return { state: 'offline', retryInMs: r.retryInMs };
    if (r.state === 'repair' || r.state === 'auth_problem')
      return { state: 'halted', retryInMs: null };
    return null;
  }
}
