import { createLiveAccumulator, type LiveAccumulator } from '@milewage/track-engine';
import { ApiClient, ApiError } from '../api/client';
import type { Flags } from '../pairing/pairing';
import type { KeyValueStore } from '../pairing/pairing';
import type { Tracker } from '../tracker/types';
import { buildEndExtras } from './endPayload';
import { PUMP_LIMIT, PointFeed, toFix } from './feed';
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
  /** Set when the driver ends the shift; the end call is retried with this same time. */
  endedAt: number | null;
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
  /** The device client and the flags from the cached settings, or null when not paired. */
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  now?: () => number;
  newId?: () => string;
  /**
   * `shift.end` is not sent until every point of the shift is uploaded or quarantined
   * (08 section 4.2 rule 9). Resolves true when it is safe. Omitted: always safe.
   */
  beforeEnd?: (clientId: string) => Promise<boolean>;
}

const KEY = 'shift.active';
const K_VEHICLE = 'shift.lastVehicle';

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
    }
    return this.active;
  }

  /** False only for the local shift whose create the server has not acknowledged yet. */
  isCreated(clientId: string): boolean {
    return !(this.active?.clientId === clientId && !this.active.created);
  }

  async vehicles(): Promise<Vehicle[]> {
    const s = await this.d.session();
    if (!s) return [];
    return (await s.client.request<Vehicle[]>('GET', '/vehicles')).data;
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
    await this.d.store.set(K_VEHICLE, String(opts.vehicleId));
    const create = await this.create(s.client, shift);
    if (create === 'ok' || create === 'pending') {
      if (create === 'ok') await this.sendOdometer(s.client, this.active!);
      return { ok: true, shift: this.active! };
    }
    await this.discard();
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
    await this.discard();
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
    return { ok: true, shift };
  }

  /** Edit the start odometer (metres); sent now if possible, else with the next `sync`. */
  async setOdometerStart(readingM: number): Promise<void> {
    if (!this.active) return;
    this.active = { ...this.active, odometerStartM: Math.round(readingM), odometerSent: false };
    await this.save();
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
      this.active = { ...shift, endedAt: this.now() };
      if (opts.odometerEndM != null) await this.putOdometer('shift_end', opts.odometerEndM);
      await this.save();
    }
    return { ok: true, sent: await this.sync() };
  }

  /**
   * Finishes anything the server has not acknowledged: create, start odometer, end. Returns true
   * when nothing is left to send. Called at app start, after the network comes back and by `end`.
   */
  async sync(): Promise<boolean> {
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
        await this.discard();
        return false;
      }
      shift = this.active!;
    }
    await this.sendOdometer(s.client, shift);
    shift = this.active!;
    if (shift.endedAt === null) return shift.odometerSent;
    if (this.d.beforeEnd && !(await this.d.beforeEnd(shift.clientId))) return false;
    try {
      const extras = s.flags.tracking
        ? buildEndExtras(this.d.tracker, { ...shift, endedAt: shift.endedAt })
        : {};
      await s.client.request('POST', `/shifts/${shift.clientId}/end`, {
        ended_at: shift.endedAt,
        ...extras,
      });
    } catch (e) {
      // 409 shift_finalized is terminal: the driver finalized it on the web, nothing more to send.
      if (!(e instanceof ApiError && e.status === 409)) {
        if (e instanceof ApiError && !e.retryable && e.status !== 404) await this.discard();
        return false;
      }
    }
    await this.discard();
    return true;
  }

  private async putOdometer(kind: 'shift_start' | 'shift_end', readingM: number) {
    const s = await this.d.session();
    if (!s || !this.active) return;
    try {
      await s.client.request('PUT', `/shifts/${this.active.clientId}/odometer/${kind}`, {
        reading_m: Math.round(readingM),
        recorded_at: this.now(),
      });
    } catch {
      // Not acknowledged: only the start reading is retried (kept in state); the end reading is
      // not queued here (the outbox arrives with M5.1).
    }
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

  private async discard() {
    this.detach();
    if (this.active?.endedAt === null) this.d.tracker.stop();
    this.active = null;
    this.acc = null;
    await this.d.store.remove(KEY);
  }

  private async save() {
    if (this.active) await this.d.store.set(KEY, JSON.stringify(this.active));
  }
}
