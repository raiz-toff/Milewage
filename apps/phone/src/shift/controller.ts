import { createLiveAccumulator, type LiveAccumulator } from '@milewage/track-engine';
import { ApiClient, ApiError } from '../api/client';
import type { Flags } from '../pairing/pairing';
import type { KeyValueStore } from '../pairing/pairing';
import type { Tracker } from '../tracker/types';
import type { ShiftStore } from '../store/shiftStore';
import { shiftOf, type Outbox } from '../sync/outbox';
import type { OutboxRunner } from '../sync/runner';
import { runLocal } from './endPayload';
import { PUMP_LIMIT, PointFeed, toFix } from './feed';
import { shiftNotice } from './notice';
import { newId } from './uuid';

/** The shift being recorded, persisted so a restart resumes it (and finishes unsent calls). */
export interface ActiveShift {
  clientId: string;
  vehicleId: number;
  startedAt: number;
  segmenter: 'stops' | 'whole_shift';
  /** `POST /shifts` was acknowledged. Until then the create is retried (idempotent on client_id). */
  created: boolean;
  odometerStartM: number | null;
  odometerSent: boolean;
  /** Set when the driver ends the shift; the hand-off to the outbox uses this same time. */
  endedAt: number | null;
  /** End odometer typed at "End shift"; kept here until the hand-off writes it to the outbox. */
  odometerEndM?: number | null;
  /**
   * Set when a retried create got 409 `shift_already_active`: the server holds another active
   * shift. The local shift keeps recording and is not dropped; the driver decides (see
   * `useServerShift`).
   */
  conflict?: ServerShift | null;
  /** The driver chose to keep the local shift; the prompt is not shown again for this shift. */
  conflictDismissed?: boolean;
}

export interface ServerShift {
  client_id: string;
  vehicle_id: number;
  started_at: number;
}

export type StartResult =
  | { ok: true; shift: ActiveShift }
  | { ok: false; reason: 'not_paired' | 'active_local' | 'tracker_refused' | 'rejected' }
  | { ok: false; reason: 'server_has_active'; active: ServerShift };

export type EndResult = { ok: true; sent: boolean } | { ok: false; reason: 'no_shift' };

export interface Vehicle {
  id: number;
  name: string;
}

export interface ShiftDeps {
  tracker: Tracker;
  feed: PointFeed;
  store: KeyValueStore;
  /** Shifts, trips and results on the phone (`app.db`). */
  shifts: ShiftStore;
  /** What the server has not acknowledged yet, and the engine that sends it. */
  outbox: Outbox;
  runner: OutboxRunner;
  /** The device client and the flags from the cached settings, or null when not paired. */
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  now?: () => number;
  newId?: () => string;
  /**
   * Called for each shift whose `shift.end` is queued, before the outbox runs: the place to upload
   * that shift's points. The barrier itself is the runner's `canSend` (08 section 4.2 rule 9).
   */
  beforeEnd?: (clientId: string) => Promise<boolean>;
}

const KEY = 'shift.active';
const K_VEHICLE = 'shift.lastVehicle';
/** The last vehicle list from the server, for starting a shift offline. */
const K_VEHICLES = 'shift.vehicles';

/** Start / end shift (09 section 5, 08 section 4.2, 02). Record first, tell the server second. */
export class ShiftController {
  private active: ActiveShift | null = null;
  private acc: LiveAccumulator | null = null;
  private unsub: (() => void) | null = null;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(private readonly d: ShiftDeps) {
    this.now = d.now ?? Date.now;
    this.id = d.newId ?? newId;
  }

  get current(): ActiveShift | null {
    return this.active;
  }

  /** Restores a shift after an app restart and re-attaches the live distance. */
  async load(): Promise<ActiveShift | null> {
    const raw = await this.d.store.get(KEY);
    this.active = raw ? (JSON.parse(raw) as ActiveShift) : null;
    if (this.active && this.active.endedAt === null) {
      this.attach(this.active);
      this.seed(this.active);
      const s = await this.d.session();
      if (s) await this.publishNotice(this.active, s.flags);
    } else if (this.active) {
      await this.handOff(); // killed between "End shift" and the hand-off
    }
    return this.active;
  }

  /** False while the server has not acknowledged this shift's create (live or queued). */
  async isCreated(clientId: string): Promise<boolean> {
    if (this.active?.clientId === clientId) return this.active.created;
    return !(await this.d.outbox.has('shift.create', clientId));
  }

  /** The shift's create was refused for good (parked): its points must not block other shifts. */
  async isParked(clientId: string): Promise<boolean> {
    return (await this.d.outbox.parked()).some(
      (i) => i.kind === 'shift.create' && i.entityKey === clientId,
    );
  }

  /**
   * The driver's vehicles. Each answer from the server is kept, so a shift can still be started
   * with no connection (the vehicle list was a dead end offline). Throws only when the server
   * cannot be reached and nothing was ever kept; `offline` says the list came from the copy.
   */
  async vehicles(): Promise<Vehicle[] & { offline?: boolean }> {
    const s = await this.d.session();
    if (!s) return [];
    try {
      const list = (await s.client.request<Vehicle[]>('GET', '/vehicles')).data;
      await this.d.store.set(
        K_VEHICLES,
        JSON.stringify(list.map(({ id, name }) => ({ id, name }))),
      );
      return list;
    } catch (e) {
      const kept = await this.d.store.get(K_VEHICLES);
      if (!kept) throw e;
      return Object.assign(JSON.parse(kept) as Vehicle[], { offline: true });
    }
  }

  async start(opts: { vehicleId: number; odometerStartM?: number | null }): Promise<StartResult> {
    const s = await this.d.session();
    if (!s) return { ok: false, reason: 'not_paired' };
    if (this.active) return { ok: false, reason: 'active_local' };
    const shift: ActiveShift = {
      clientId: this.id(),
      vehicleId: opts.vehicleId,
      startedAt: this.now(),
      segmenter: s.flags.segmenter,
      created: false,
      odometerStartM: opts.odometerStartM ?? null,
      odometerSent: false,
      endedAt: null,
    };
    // Record first: the tracker runs before any network call. With the tracking module off
    // on the server the phone does not start the tracker at all (08 F22).
    if (s.flags.tracking && !this.d.tracker.start(shift.clientId)) {
      return { ok: false, reason: 'tracker_refused' };
    }
    this.active = shift;
    this.attach(shift);
    await this.save();
    await this.begin(shift, s.flags.timezone);
    await this.publishNotice(shift, s.flags);
    if (shift.odometerStartM !== null) {
      await this.d.shifts.setOdometer(
        shift.clientId,
        'shift_start',
        shift.odometerStartM,
        shift.startedAt,
      );
    }
    await this.d.store.set(K_VEHICLE, String(opts.vehicleId));
    const create = await this.create(s.client, shift);
    if (create === 'ok' || create === 'pending') {
      if (create === 'ok') await this.sendOdometer(s.client, this.active!);
      return { ok: true, shift: this.active! };
    }
    await this.discard(true);
    return create.kind === 'conflict'
      ? { ok: false, reason: 'server_has_active', active: create.active }
      : { ok: false, reason: 'rejected' };
  }

  /** The vehicle used for the previous shift, to preselect it; null if none. */
  async lastVehicleId(): Promise<number | null> {
    const n = Number(await this.d.store.get(K_VEHICLE));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /** The server shift that blocks this phone's unacknowledged local shift, if any. */
  get conflict(): ServerShift | null {
    return this.active?.conflict ?? null;
  }

  /**
   * The driver chose the server's shift over the local unsent one: the local recording is stopped
   * and forgotten (its stored points stay in the buffer, but the server has no such shift, so
   * they will be parked by the upload worker), then the server's shift is continued.
   */
  async useServerShift(): Promise<StartResult> {
    const conflict = this.conflict;
    if (!conflict) return { ok: false, reason: 'rejected' };
    await this.discard(true);
    return this.adopt(conflict);
  }

  /** The driver chose to keep the local shift and try again later; the prompt is dismissed. */
  async keepLocalShift(): Promise<void> {
    if (!this.active?.conflict) return;
    this.active = { ...this.active, conflict: null, conflictDismissed: true };
    await this.save();
  }

  /** The driver chose to continue the server's active shift (409 `shift_already_active`). */
  async adopt(server: ServerShift): Promise<StartResult> {
    const s = await this.d.session();
    if (!s) return { ok: false, reason: 'not_paired' };
    if (this.active) return { ok: false, reason: 'active_local' };
    const shift: ActiveShift = {
      clientId: server.client_id,
      vehicleId: server.vehicle_id,
      startedAt: server.started_at,
      segmenter: s.flags.segmenter,
      created: true,
      odometerStartM: null,
      odometerSent: true,
      endedAt: null,
    };
    if (s.flags.tracking && !this.d.tracker.start(shift.clientId)) {
      return { ok: false, reason: 'tracker_refused' };
    }
    this.active = shift;
    this.attach(shift);
    await this.save();
    await this.begin(shift, s.flags.timezone);
    await this.publishNotice(shift, s.flags);
    return { ok: true, shift };
  }

  /**
   * Tells the tracker what the running-shift notification says around the distance (today's
   * earlier shifts, start time, vehicle). Best effort: without it the notification still shows the
   * distance and the clock.
   */
  private async publishNotice(shift: ActiveShift, flags: Flags) {
    if (!flags.tracking) return;
    try {
      const kept = await this.d.store.get(K_VEHICLES);
      const vehicles = kept ? (JSON.parse(kept) as Vehicle[]) : [];
      this.d.tracker.setNotice(
        shiftNotice({
          clientId: shift.clientId,
          startedAt: shift.startedAt,
          vehicle: vehicles.find((v) => v.id === shift.vehicleId)?.name ?? null,
          rows: await this.d.shifts.list(200),
          unit: flags.distanceUnit,
          timeZone: flags.timezone,
        }),
      );
    } catch {
      // The notification keeps its plain text; tracking is not affected.
    }
  }

  private begin(shift: ActiveShift, timeZone: string) {
    return this.d.shifts.begin({
      clientId: shift.clientId,
      vehicleId: shift.vehicleId,
      segmenter: shift.segmenter,
      startedAt: shift.startedAt,
      timeZone,
    });
  }

  /** Edit the start odometer (metres); sent now if possible, else with the next `sync`. */
  async setOdometerStart(readingM: number): Promise<void> {
    if (!this.active) return;
    this.active = { ...this.active, odometerStartM: Math.round(readingM), odometerSent: false };
    await this.save();
    await this.d.shifts.setOdometer(
      this.active.clientId,
      'shift_start',
      this.active.odometerStartM!,
      this.active.startedAt,
    );
    await this.sync();
  }

  /** Reads new fixes and returns the approximate running distance in whole metres. */
  pump(): number {
    if (this.active) this.d.feed.readPending(PUMP_LIMIT);
    return this.acc?.runningTotalM() ?? 0;
  }

  async end(opts: { odometerEndM?: number | null } = {}): Promise<EndResult> {
    const shift = this.active;
    if (!shift) return { ok: false, reason: 'no_shift' };
    if (shift.endedAt === null) {
      this.pump(); // last look at the buffer so the live number matches what was recorded
      this.d.tracker.stop();
      this.detach();
      this.active = { ...shift, endedAt: this.now(), odometerEndM: opts.odometerEndM ?? null };
      await this.save();
    }
    await this.handOff();
    return { ok: true, sent: await this.sync() };
  }

  /**
   * Ends the shift on the phone: runs the shared engine over the stored points, queues what the
   * server has not seen (create, odometer readings, then `shift.end` with the manifest and the
   * phone's result) and stores the totals, trips, stops and route, so everything shows offline
   * (15 section 5). Safe to run again after a kill: the queue is written first and `shift.end`
   * last, and a shift that is already `ended` is left alone.
   */
  private async handOff(): Promise<void> {
    const shift = this.active;
    if (!shift || shift.endedAt === null) return;
    const s = await this.d.session();
    const endedAt = shift.endedAt;
    const local = !s || s.flags.tracking ? runLocal(this.d.tracker, { ...shift, endedAt }) : null;
    const { outbox, shifts } = this.d;
    if (!(await outbox.has('shift.end', shift.clientId))) {
      if (!shift.created) {
        await outbox.enqueue('shift.create', shift.clientId, {
          client_id: shift.clientId,
          vehicle_id: shift.vehicleId,
          started_at: shift.startedAt,
          segmenter: shift.segmenter,
        });
      }
      if (shift.odometerStartM !== null && !shift.odometerSent) {
        await outbox.enqueue('odometer.put', `${shift.clientId}:shift_start`, {
          reading_m: shift.odometerStartM,
          recorded_at: shift.startedAt,
        });
      }
      if (shift.odometerEndM != null) {
        await outbox.enqueue('odometer.put', `${shift.clientId}:shift_end`, {
          reading_m: Math.round(shift.odometerEndM),
          recorded_at: endedAt,
        });
      }
      await outbox.enqueue('shift.end', shift.clientId, { ended_at: endedAt, ...local?.extras });
    }
    if (shift.odometerEndM != null) {
      await shifts.setOdometer(shift.clientId, 'shift_end', shift.odometerEndM, endedAt);
    }
    await shifts.finish({
      clientId: shift.clientId,
      endedAt,
      result: local?.result ?? null,
      manifest: local?.manifest ?? null,
    });
    await this.discard(false);
  }

  /**
   * Finishes anything the server has not acknowledged: the running shift's create and start
   * odometer, then the outbox (ended shifts: create, odometer, `end`). Returns true when nothing
   * is left to send. Called at app start, after the network comes back and by `end`.
   */
  async sync(): Promise<boolean> {
    if (this.active && this.active.endedAt !== null) await this.handOff();
    const live = this.active ? await this.syncRunning() : true;
    return (await this.flushOutbox()) && live;
  }

  private async flushOutbox(): Promise<boolean> {
    const { outbox, runner } = this.d;
    if (this.d.beforeEnd) {
      const ending = new Set(
        (await outbox.pending())
          .filter((i) => i.kind === 'shift.end')
          .map((i) => shiftOf(i.entityKey)),
      );
      for (const id of ending) await this.d.beforeEnd(id);
    }
    await runner.run();
    const c = await outbox.counts();
    return c.pending === 0 && c.parked === 0;
  }

  /** The running shift's create and start odometer (its points go through the upload worker). */
  async syncRunning(): Promise<boolean> {
    let shift = this.active;
    if (!shift) return true;
    const s = await this.d.session();
    if (!s) return false;
    if (!shift.created) {
      const r = await this.create(s.client, shift);
      if (r !== 'ok') {
        if (r === 'pending') return false;
        if (typeof r === 'object' && r.kind === 'conflict') {
          // Keep recording; ask the driver instead of dropping miles silently.
          if (this.active && !this.active.conflictDismissed) {
            this.active = { ...this.active, conflict: this.active.conflict ?? r.active };
            await this.save();
          }
          return false;
        }
        await this.discard(true);
        return false;
      }
      shift = this.active!;
    }
    await this.sendOdometer(s.client, shift);
    return this.active!.odometerSent || this.active!.odometerStartM === null;
  }

  private async sendOdometer(client: ApiClient, shift: ActiveShift) {
    if (shift.odometerStartM === null || shift.odometerSent) return;
    try {
      await client.request('PUT', `/shifts/${shift.clientId}/odometer/shift_start`, {
        reading_m: shift.odometerStartM,
        recorded_at: shift.startedAt,
      });
      this.active = { ...this.active!, odometerSent: true };
      await this.save();
    } catch {
      // Retried by the next sync.
    }
  }

  private async create(
    client: ApiClient,
    shift: ActiveShift,
  ): Promise<'ok' | 'pending' | { kind: 'conflict'; active: ServerShift } | { kind: 'rejected' }> {
    try {
      await client.request('POST', '/shifts', {
        client_id: shift.clientId,
        vehicle_id: shift.vehicleId,
        started_at: shift.startedAt,
        segmenter: shift.segmenter,
      });
      this.active = { ...shift, created: true };
      await this.save();
      return 'ok';
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.retryable) return 'pending';
      const body = e.body as { active_shift?: ServerShift } | null;
      if (e.status === 409 && body?.active_shift) {
        return { kind: 'conflict', active: body.active_shift };
      }
      return { kind: 'rejected' };
    }
  }

  private attach(shift: ActiveShift) {
    this.detach();
    const acc = createLiveAccumulator(shift.startedAt);
    this.acc = acc;
    this.unsub = this.d.feed.subscribe((p) => {
      if (p.shiftClientId === shift.clientId) acc.push(toFix(p));
    });
  }

  /**
   * After a restart the live distance is rebuilt from every stored row of the shift, PENDING and
   * UPLOADED alike (the accumulator skips a seq it has seen, so points the feed announces again
   * are not counted twice). Rows evicted after the retention period are gone; a running shift is
   * far younger than that.
   */
  private seed(shift: ActiveShift) {
    let after = 0;
    for (;;) {
      const page = this.d.tracker.readByShift(shift.clientId, after, PUMP_LIMIT);
      for (const p of page) this.acc?.push(toFix(p));
      const last = page[page.length - 1];
      if (!last || page.length < PUMP_LIMIT) return;
      after = last.seq;
    }
  }

  private detach() {
    this.unsub?.();
    this.unsub = null;
  }

  /** Forgets the running shift. `dropRecord` also removes its row, queue and results (it never reached the server). */
  private async discard(dropRecord: boolean) {
    const id = this.active?.clientId;
    this.detach();
    if (this.active?.endedAt === null) this.d.tracker.stop();
    this.active = null;
    this.acc = null;
    await this.d.store.remove(KEY);
    if (dropRecord && id) {
      await this.d.outbox.dropShift(id);
      await this.d.shifts.remove(id);
    }
  }

  private async save() {
    if (this.active) await this.d.store.set(KEY, JSON.stringify(this.active));
  }
}
