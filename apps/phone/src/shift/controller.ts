import { createLiveAccumulator, type LiveAccumulator } from '@milewage/track-engine';
import { ApiClient, ApiError } from '../api/client';
import type { Flags } from '../pairing/pairing';
import {
  buildShiftSummary,
  type BatteryPort,
  type BatteryReading,
  type ShiftSummary,
} from '../diagnostics/shiftSummary';
import type { KeyValueStore } from '../pairing/pairing';
import type { Tracker } from '../tracker/types';
import type { ShiftStore } from '../store/shiftStore';
import type { ShiftQueue } from '../sync/outbox';
import type { Recorder } from '../sync/sender';
import { encode, send, type QueuedChange } from '../sync/shiftRequests';
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
  /** Battery at "Start shift" and at "End shift", for `shift.summary`; absent when unknown. */
  batteryStart?: BatteryReading | null;
  batteryEnd?: BatteryReading | null;
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

export type EndResult = { ok: true } | { ok: false; reason: 'no_shift' };

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
  /** Where the ended shift's create, odometer readings and `end` wait for the sender. */
  queue: ShiftQueue;
  /** The device client and the flags from the cached settings, or null when not paired. */
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  now?: () => number;
  newId?: () => string;
  /** Battery at shift start and end. Absent or null: no `shift.summary` is sent. */
  battery?: BatteryPort;
  /** Receives the `shift.summary` of a shift once, when its `shift.end` is queued. */
  onSummary?: (clientId: string, summary: ShiftSummary) => Promise<void> | void;
}

/** The shift's create, queued at the hand-off or sent at once while it runs. */
const createOf = (shift: ActiveShift): QueuedChange => ({
  type: 'shift.create',
  clientId: shift.clientId,
  vehicleId: shift.vehicleId,
  startedAt: shift.startedAt,
  segmenter: shift.segmenter,
});

const startOdometerOf = (shift: ActiveShift, readingM: number): QueuedChange => ({
  type: 'odometer.put',
  clientId: shift.clientId,
  reading: 'shift_start',
  readingM,
  recordedAt: shift.startedAt,
});

const KEY = 'shift.active';
const K_VEHICLE = 'shift.lastVehicle';
/** The last vehicle list from the server, for starting a shift offline. */
const K_VEHICLES = 'shift.vehicles';

/**
 * Start / end shift (09 section 5, 08 section 4.2, 02). Record first, tell the server second.
 * It sends the running shift's create itself, because the answer decides whether the shift runs;
 * everything else it hands to the queue at "End shift", and the sender (`sync/sender.ts`) sends it.
 */
export class ShiftController implements Recorder {
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

  /** True while a shift is recorded and not ended, read without attaching anything. */
  async running(): Promise<boolean> {
    const raw = this.active ? null : await this.d.store.get(KEY);
    const a = this.active ?? (raw ? (JSON.parse(raw) as ActiveShift) : null);
    return !!a && a.endedAt === null;
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
    shift.batteryStart = await this.battery();
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

  /** The battery now, or null when unknown. Never fails a start or an end. */
  private async battery(): Promise<BatteryReading | null> {
    try {
      return (await this.d.battery?.read()) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Hands the shift's `shift.summary` (16 section 3.2) to diagnostics. Only when both battery
   * levels are known: the allowlist requires them, and a guessed level would mislead the battery
   * health check (H7). Best effort: ending the shift never depends on it.
   */
  private async summarise(
    shift: ActiveShift,
    endedAt: number,
    local: ReturnType<typeof runLocal>,
    engineMs: number,
  ) {
    if (!this.d.onSummary || !shift.batteryStart || !shift.batteryEnd) return;
    try {
      await this.d.onSummary(
        shift.clientId,
        buildShiftSummary({
          startedAt: shift.startedAt,
          endedAt,
          start: shift.batteryStart,
          end: shift.batteryEnd,
          local,
          engineMs,
        }),
      );
    } catch {
      // Diagnostics are best effort.
    }
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
   * the sender sets them aside), then the server's shift is continued.
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

  /** Edit the start odometer (metres); sent now if possible, else with the sender's next round. */
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
    await this.sendRunning();
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
      this.active = {
        ...shift,
        endedAt: this.now(),
        odometerEndM: opts.odometerEndM ?? null,
        batteryEnd: shift.batteryStart ? await this.battery() : null,
      };
      await this.save();
    }
    await this.handOff();
    return { ok: true };
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
    const engineFrom = this.now();
    const local = !s || s.flags.tracking ? runLocal(this.d.tracker, { ...shift, endedAt }) : null;
    const engineMs = this.now() - engineFrom;
    const { queue, shifts } = this.d;
    if (!(await queue.has('shift.end', shift.clientId))) {
      if (!shift.created) await queue.enqueue(createOf(shift));
      if (shift.odometerStartM !== null && !shift.odometerSent) {
        await queue.enqueue(startOdometerOf(shift, shift.odometerStartM));
      }
      if (shift.odometerEndM != null) {
        await queue.enqueue({
          type: 'odometer.put',
          clientId: shift.clientId,
          reading: 'shift_end',
          readingM: shift.odometerEndM,
          recordedAt: endedAt,
        });
      }
      await queue.enqueue({
        type: 'shift.end',
        clientId: shift.clientId,
        endedAt,
        manifest: local?.manifest ?? null,
        phoneResult: local?.phoneResult ?? null,
      });
      await this.summarise(shift, endedAt, local, engineMs);
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
   * What sending needs from the recorder (the sender calls it each round, before the running
   * shift's points): a hand-off cut short by a kill is finished, then the running shift's create
   * and start odometer are sent. True when none of that is left.
   */
  async sendRunning(): Promise<boolean> {
    if (this.active && this.active.endedAt !== null) await this.handOff();
    return this.active ? this.syncRunning() : true;
  }

  /** The running shift's create and start odometer (its points go through the sender). */
  private async syncRunning(): Promise<boolean> {
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
      await send(client, encode(startOdometerOf(shift, shift.odometerStartM)));
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
      await send(client, encode(createOf(shift)));
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
      await this.d.queue.dropShift(id);
      await this.d.shifts.remove(id);
    }
  }

  private async save() {
    if (this.active) await this.d.store.set(KEY, JSON.stringify(this.active));
  }
}
