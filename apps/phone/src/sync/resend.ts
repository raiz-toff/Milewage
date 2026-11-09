import { ApiError, type ApiClient } from '../api/client';
import type { AppSqlDb } from '../db/appDb';
import type { DeviceSession } from '../pairing/deviceSession';
import { runLocal } from '../shift/endPayload';
import { PUMP_LIMIT, type PointFeed } from '../shift/feed';
import type { ShiftRow, ShiftStore } from '../store/shiftStore';
import type { Tracker } from '../tracker/types';
import { Backoff, BACKLOG_BATCH } from './points';
import type { ConnectionMonitor } from './connection';
import type { Outbox } from './outbox';
import type { OutboxRunner } from './runner';
import { encode, halvedBatch, manualTripOf, send, type QueuedChange } from './shiftRequests';

/** `sync_state` keys `resend:<shift client_id>`: one per shift still to be sent again. */
export const RESEND_PREFIX = 'resend:';
const DAY = 86_400_000;
/**
 * A device sees only the shifts of the last 14 days, or the ones it wrote to in that time
 * (08 section 2.2). A shift the restored server kept and that is older than this is out of the
 * phone's reach: it is on the server, and nothing more can be sent to it. One day of margin.
 */
const REACH_MS = 13 * DAY;
/** How often one run starts over because the server was restored again while it was sending. */
const MAX_RESTARTS = 3;

/**
 * Where a shift is in the resend. `todo`: nothing of it was accepted again since the restore
 * `gen` (or `after`, the last point seq accepted again). `queued`: created again, points sent
 * again, and its odometer, trips and end are in the outbox; the row goes when `end` is accepted.
 */
export interface ResendEntry {
  gen: number;
  phase: 'todo' | 'queued';
  after: number;
}

/** The stored form. Writes compare the whole old value, so a restore in between always wins. */
export const resendValue = (e: ResendEntry): string =>
  JSON.stringify({ gen: e.gen, phase: e.phase, after: e.after });

export interface ResendDeps {
  db: AppSqlDb;
  store: ShiftStore;
  outbox: Outbox;
  runner: OutboxRunner;
  tracker: Tracker;
  feed: PointFeed;
  monitor: ConnectionMonitor;
  session: () => Promise<{ client: ApiClient } | null>;
  /** The device session: a halt stops the resend; it goes on after `resume`. */
  device: Pick<DeviceSession, 'halted'>;
  now?: () => number;
  rand?: () => number;
}

export interface ResendResult {
  state: 'idle' | 'offline' | 'halted' | 'cancelled';
  retryInMs: number | null;
  /** Shifts the server accepted again in this run. */
  shifts: number;
  /** Points sent again in this run. */
  points: number;
  /** A shift was created again: the upload worker may have set its points aside meanwhile. */
  recreated: boolean;
}

type Stop = { stop: 'offline'; retryInMs: number } | { stop: 'halted' | 'cancelled' };
type Outcome = 'done' | 'skipped' | 'waiting' | 'restarted' | Stop;

interface Held {
  id: string;
  raw: string;
  entry: ResendEntry;
}

/**
 * Internal to the sender (`sender.ts`).
 *
 * Sends again what a server restored from an older backup may have lost (15 section 9.3). The
 * connection monitor writes one `resend:` row per shift the server once acknowledged; this sends
 * each one again, oldest first, the same way a shift is sent the first time (15 section 6.2):
 * create, all its points still on the phone, then odometer readings, `end` and trip edits through
 * the outbox. Everything is idempotent on the server: the shift by its `client_id`, points by
 * `(device, seq)`, readings and edits as upserts, and `end` of an ended shift answers the stored
 * result. So a shift the restore kept is answered as it is, and nothing is doubled.
 *
 * Eviction of the phone's own copies stays blocked while any row is left (15 section 3.2). A
 * shift becomes "on server" again when its `end` is accepted, as after its first upload.
 */
export class RestoreResend {
  private loaded = false;
  private count = 0;
  private readonly now: () => number;
  private readonly backoff: Backoff;
  private recreated = false;

  constructor(private readonly d: ResendDeps) {
    this.now = d.now ?? Date.now;
    this.backoff = new Backoff(d.rand);
  }

  /** True while shifts are waiting to be sent again (read now, so it holds after an app restart). */
  async waiting(): Promise<boolean> {
    return (await this.list()).length > 0;
  }

  /** For the point uploader: blocked until the rows were read once, then while any is left. */
  blocksEviction(): boolean {
    if (!this.loaded) {
      void this.list().catch(() => undefined);
      return true;
    }
    return this.count > 0;
  }

  /**
   * For the queue's barrier: nothing of a shift goes out before the server has accepted it again,
   * so an odometer or `end` queued before the restore is not refused for a shift it lost.
   */
  async holds(shiftClientId: string): Promise<boolean> {
    const row = await this.d.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_state WHERE key = ?',
      RESEND_PREFIX + shiftClientId,
    );
    return !!row && parse(row.value)?.phase === 'todo';
  }

  /** Shifts not yet created again; the backlog drain leaves them to `run`. */
  async held(): Promise<string[]> {
    return (await this.list()).filter((h) => h.entry.phase === 'todo').map((h) => h.id);
  }

  /**
   * One pass over the shifts to send again. `live` is the running shift: it goes first, and the
   * ended shifts wait until it has ended, because the server holds one active shift per user and
   * an old shift is active there from its create until its end.
   */
  async run(o: { live: string | null; shouldStop: () => boolean }): Promise<ResendResult> {
    const res: ResendResult = {
      state: 'idle',
      retryInMs: null,
      shifts: 0,
      points: 0,
      recreated: false,
    };
    this.recreated = false;
    const finish = async (r: ResendResult) => {
      await this.settle();
      return { ...r, recreated: this.recreated };
    };
    await this.d.monitor.settled();
    for (let pass = 0; pass <= MAX_RESTARTS; pass++) {
      const held = await this.ordered(await this.list(), o.live);
      let restarted = false;
      for (const h of held) {
        if (o.shouldStop()) return finish({ ...res, state: 'cancelled' });
        const out = await this.one(h, o.live, o.shouldStop, res);
        if (out === 'done') res.shifts++;
        else if (out === 'restarted') {
          restarted = true;
          break;
        } else if (typeof out === 'object') {
          if (out.stop === 'offline') {
            return finish({ ...res, state: 'offline', retryInMs: out.retryInMs });
          }
          return finish({ ...res, state: out.stop });
        }
      }
      if (!restarted) break;
    }
    return finish(res);
  }

  /**
   * Removes the shifts whose `end` the server has accepted again; when none is left the restore
   * notice goes away. Called after every run of the outbox.
   */
  async settle(): Promise<void> {
    await this.d.monitor.settled();
    for (const h of await this.list()) {
      if (h.entry.phase !== 'queued') continue;
      if (!(await this.d.outbox.has('shift.end', h.id))) await this.drop(h);
    }
    if ((await this.list()).length === 0) this.d.monitor.acknowledgeRestore();
  }

  private async list(): Promise<Held[]> {
    const rows = await this.d.db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM sync_state WHERE key LIKE 'resend:%'",
    );
    const out: Held[] = [];
    for (const r of rows) {
      const entry = parse(r.value);
      if (entry) out.push({ id: r.key.slice(RESEND_PREFIX.length), raw: r.value, entry });
    }
    this.loaded = true;
    this.count = out.length;
    return out;
  }

  /** The running shift first, then oldest first. */
  private async ordered(held: Held[], live: string | null): Promise<Held[]> {
    const started = new Map<string, number>();
    for (const h of held) started.set(h.id, (await this.d.store.get(h.id))?.started_at ?? 0);
    return [...held].sort(
      (a, b) =>
        Number(b.id === live) - Number(a.id === live) || started.get(a.id)! - started.get(b.id)!,
    );
  }

  /** Writes `next` only if the row is still as read in `h`; null when a restore changed it meanwhile. */
  private async swap(h: Held, next: ResendEntry): Promise<Held | null> {
    const raw = resendValue(next);
    const r = await this.d.db.runAsync(
      'UPDATE sync_state SET value = ? WHERE key = ? AND value = ?',
      raw,
      RESEND_PREFIX + h.id,
      h.raw,
    );
    return r.changes === 1 ? { id: h.id, raw, entry: next } : null;
  }

  private async drop(h: Held): Promise<boolean> {
    const r = await this.d.db.runAsync(
      'DELETE FROM sync_state WHERE key = ? AND value = ?',
      RESEND_PREFIX + h.id,
      h.raw,
    );
    if (r.changes === 1) this.count = Math.max(0, this.count - 1);
    return r.changes === 1;
  }

  private async one(
    h: Held,
    live: string | null,
    shouldStop: () => boolean,
    res: ResendResult,
  ): Promise<Outcome> {
    const { store } = this.d;
    if (h.entry.phase === 'queued') return 'waiting'; // `settle` removes it once `end` is accepted
    const row = await store.get(h.id);
    if (!row) {
      // Deleted on the web meanwhile: the server's delete wins (15 section 8.4).
      await this.drop(h);
      return 'skipped';
    }
    const running = row.status === 'active';
    if (live !== null && h.id !== live) return 'waiting';
    // Not ended, but not the shift being recorded (the app has not loaded it yet): sent once it is,
    // never created as an active shift the phone could not end.
    if (running && h.id !== live) return 'waiting';
    if (!running && !(await this.ownedHere(row))) {
      // Known only from the server's feed (another phone, or before a reinstall): the phone holds
      // no points and no result of its own, so it has nothing to send. It was the server's copy.
      if (row.sync_state === 'local') await store.setSyncState(row.client_id, 'on_server');
      await this.drop(h);
      return 'skipped';
    }
    const s = await this.d.session();
    if (!s) return 'waiting';

    // 1. The shift itself. 201: created again. 200: the restore kept it (returned unchanged).
    let kept: { status?: string } | null = null;
    try {
      const create = encode({
        type: 'shift.create',
        clientId: row.client_id,
        vehicleId: row.vehicle_id,
        startedAt: row.started_at,
        segmenter: row.segmenter,
        notes: row.notes,
      });
      const r = await send<{ status?: string }>(s.client, create);
      if (r.status === 201) this.recreated = true;
      else kept = r.data ?? {};
    } catch (e) {
      return this.failed(e, row);
    }
    this.backoff.reset();
    await this.d.monitor.settled();
    if (kept && !running && kept.status !== 'active' && row.started_at < this.now() - REACH_MS) {
      if (row.sync_state === 'local') await store.setSyncState(row.client_id, 'on_server');
      return (await this.drop(h)) ? 'done' : 'restarted';
    }

    // 2. Every point still on the phone, in seq order.
    const sent = await this.points(s.client, h, shouldStop, res);
    if (sent === 'restarted' || 'stop' in sent) return sent;

    // 3. Odometer readings, then `end` and trip edits, through the outbox (held until now).
    await this.queue(row);
    if (running) return (await this.drop(sent.h)) ? 'done' : 'restarted';
    if (!(await this.swap(sent.h, { ...sent.h.entry, phase: 'queued' }))) return 'restarted';
    const r = await this.d.runner.run({ shift: row.client_id });
    if (r.state === 'offline') return { stop: 'offline', retryInMs: r.retryInMs ?? 0 };
    if (r.state === 'halted') return { stop: 'halted' };
    return 'done';
  }

  /** The phone recorded this shift: it has a manifest, its own result, points, or queued work. */
  private async ownedHere(row: ShiftRow): Promise<boolean> {
    if (row.first_seq !== null || row.input_digest !== null) return true;
    if (this.d.tracker.readByShift(row.client_id, 0, 1).length > 0) return true;
    const queued = [...(await this.d.outbox.pending()), ...(await this.d.outbox.parked())];
    return queued.some((i) => i.entityKey.split(':')[0] === row.client_id);
  }

  /**
   * The shift's acknowledged points, in batches of 500, from where the last attempt stopped.
   * Points still pending are left to the upload worker, which also feeds the live distance.
   * Points stay as they are in the buffer: they were acknowledged once and are kept anyway.
   */
  private async points(
    client: ApiClient,
    start: Held,
    shouldStop: () => boolean,
    res: ResendResult,
  ): Promise<{ h: Held } | 'restarted' | Stop> {
    const id = start.id;
    const pending = new Set(
      this.d.feed
        .readPending(PUMP_LIMIT)
        .filter((p) => p.shiftClientId === id)
        .map((p) => p.seq),
    );
    let h = start;
    let size = BACKLOG_BATCH;
    for (;;) {
      if (shouldStop()) return { stop: 'cancelled' };
      const page = this.d.tracker.readByShift(id, h.entry.after, size);
      const last = page[page.length - 1];
      if (!last) return { h };
      const batch = page.filter((p) => !pending.has(p.seq));
      if (batch.length > 0) {
        try {
          await send(client, encode({ type: 'telemetry.batch', clientId: id, points: batch }));
          res.points += batch.length;
          this.backoff.reset();
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          if (e.status === 409 && e.code === 'shift_finalized') return { h }; // nothing more fits
          const smaller = halvedBatch(e, batch.length);
          if (smaller !== null) {
            size = smaller;
            continue;
          }
          if (e.status !== 422) return await this.stop(e);
          // One point the server refuses for good: it is skipped, never deleted.
        }
      }
      await this.d.monitor.settled();
      const next = await this.swap(h, { ...h.entry, after: last.seq });
      if (!next) return 'restarted';
      h = next;
    }
  }

  private async queue(row: ShiftRow): Promise<void> {
    const { outbox, store } = this.d;
    const id = row.client_id;
    for (const o of await store.odometer(id)) {
      await outbox.enqueue({
        type: 'odometer.put',
        clientId: id,
        reading: o.kind,
        readingM: o.reading_m,
        recordedAt: o.recorded_at,
      });
    }
    if (row.status === 'active' || row.ended_at === null) return;
    if (!(await outbox.has('shift.end', id))) {
      await outbox.enqueue(await this.endOf(row));
    }
    for (const t of await store.trips(id)) {
      if (t.source === 'manual') {
        await outbox.enqueue(manualTripOf(id, t, t.edited_at ?? row.updated_at));
      } else if (t.edited_at !== null) {
        await outbox.enqueue({
          type: 'trip.override',
          tripKey: t.trip_key,
          kind: t.kind,
          purpose: t.purpose,
          editedAt: t.edited_at,
        });
      }
    }
  }

  /**
   * `end` as at the first upload: the manifest and the phone's result from the points still on
   * the phone (15 section 6.1). With the points gone, the manifest and result stored at shift end,
   * so the server reports the difference and the phone keeps its numbers in the diff log.
   */
  private async endOf(row: ShiftRow): Promise<QueuedChange> {
    const endedAt = row.ended_at!;
    const end = { type: 'shift.end', clientId: row.client_id, endedAt } as const;
    const local = runLocal(this.d.tracker, {
      clientId: row.client_id,
      startedAt: row.started_at,
      endedAt,
      segmenter: row.segmenter,
    });
    if (local) return { ...end, manifest: local.manifest, phoneResult: local.phoneResult };
    const manifest =
      row.first_seq !== null && row.last_seq !== null && row.point_count !== null
        ? { firstSeq: row.first_seq, lastSeq: row.last_seq, pointCount: row.point_count }
        : null;
    if (
      row.input_digest === null ||
      row.calc_version === null ||
      row.total_m === null ||
      row.active_m === null ||
      row.deadhead_m === null ||
      row.personal_m === null
    ) {
      return { ...end, manifest, phoneResult: null };
    }
    const trips = await this.d.store.trips(row.client_id);
    return {
      ...end,
      manifest,
      phoneResult: {
        calcVersion: row.calc_version,
        segmenter: row.segmenter,
        inputDigest: row.input_digest,
        totalM: row.total_m,
        activeM: row.active_m,
        deadheadM: row.deadhead_m,
        personalM: row.personal_m,
        tripsCount: trips.filter((t) => t.source === 'auto').length,
      },
    };
  }

  private async failed(e: unknown, row: ShiftRow): Promise<Outcome> {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 409 && e.code === 'shift_already_active') return 'waiting'; // tried again later
    if (e.retryable || (await this.d.device.halted())) return this.stop(e);
    // Refused for good (a vehicle the restored server does not know, for example): the driver
    // sees the shift needs attention; the phone keeps it and tries again on the next sync.
    await this.d.store.setSyncState(row.client_id, 'needs_attention');
    return 'waiting';
  }

  private async stop(e: ApiError): Promise<Stop> {
    if (await this.d.device.halted()) return { stop: 'halted' };
    return { stop: 'offline', retryInMs: this.backoff.next(e.retryAfterS) };
  }
}

function parse(raw: string): ResendEntry | null {
  try {
    const v = JSON.parse(raw) as Partial<ResendEntry>;
    if (typeof v.gen !== 'number' || typeof v.after !== 'number') return null;
    return { gen: v.gen, phase: v.phase === 'queued' ? 'queued' : 'todo', after: v.after };
  } catch {
    return null;
  }
}
