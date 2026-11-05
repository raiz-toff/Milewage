import type { AppSqlDb } from '../db/appDb';
import type { Outbox } from '../sync/outbox';
import type { ShiftStore, TripRow } from './shiftStore';
import { newId } from '../shift/uuid';

export type TripKind = 'active' | 'deadhead' | 'personal';

export type EditResult =
  | { ok: true }
  | { ok: false; reason: 'no_shift' | 'finalized' | 'no_trip' | 'not_editable' | 'invalid' };

export interface EditDeps {
  db: AppSqlDb;
  store: ShiftStore;
  outbox: Outbox;
  /** `tracker.gnssOffsetMs()`: edit times are GNSS-corrected when a fix is fresh (15 section 10). */
  gnssOffsetMs: () => number | null;
  now?: () => number;
  newId?: () => string;
}

/**
 * Driver edits on the phone (15 section 8.1): reclassify a trip or change its purpose, add a manual
 * trip, correct an odometer reading, change shift notes. Each one is written to `app.db` at once
 * (so it shows offline) and queued with its edit time; the server decides by last-writer-wins and
 * the pull applies its answer. Distance of an automatic trip is never editable (07 section 3 rule 8)
 * and a finalized shift cannot be edited (409 on the server). The phone never deletes server data.
 */
export class PhoneEdits {
  constructor(private readonly d: EditDeps) {}

  private stamp(): number {
    const now = (this.d.now ?? Date.now)();
    return now + (this.d.gnssOffsetMs() ?? 0);
  }

  private async guard(clientId: string) {
    const s = await this.d.store.get(clientId);
    if (!s) return 'no_shift' as const;
    return s.status === 'finalized' ? ('finalized' as const) : null;
  }

  async editTrip(
    tripKey: string,
    edit: { kind?: TripKind; purpose?: string },
  ): Promise<EditResult> {
    const trip = await this.d.db.getFirstAsync<TripRow>(
      'SELECT * FROM trips WHERE trip_key = ?',
      tripKey,
    );
    if (!trip) return { ok: false, reason: 'no_trip' };
    const bad = await this.guard(trip.shift_client_id);
    if (bad) return { ok: false, reason: bad };
    const kind = edit.kind ?? trip.kind;
    const purpose = edit.purpose ?? trip.purpose;
    if (!['active', 'deadhead', 'personal'].includes(kind) || purpose.length > 200) {
      return { ok: false, reason: 'invalid' };
    }
    const at = this.stamp();
    await this.d.db.runAsync(
      "UPDATE trips SET kind = ?, purpose = ?, edited_at = ?, sync_state = 'local' WHERE trip_key = ?",
      kind,
      purpose,
      at,
      tripKey,
    );
    if (trip.source === 'manual') {
      await this.queueManual(trip.shift_client_id, { ...trip, kind, purpose }, at);
    } else {
      await this.d.outbox.enqueue('trip.override', tripKey, { kind, purpose, edited_at: at });
    }
    await this.move(trip.shift_client_id, trip.kind, kind, trip.distance_m);
    return { ok: true };
  }

  async addManualTrip(
    clientId: string,
    t: { kind: TripKind; startedAt: number; endedAt: number; distanceM: number; purpose: string },
  ): Promise<EditResult> {
    const bad = await this.guard(clientId);
    if (bad) return { ok: false, reason: bad };
    if (
      !Number.isInteger(t.distanceM) ||
      t.distanceM <= 0 ||
      t.endedAt < t.startedAt ||
      t.purpose.length > 200
    ) {
      return { ok: false, reason: 'invalid' };
    }
    const key = (this.d.newId ?? newId)().toLowerCase();
    const at = this.stamp();
    const row = {
      trip_key: key,
      shift_client_id: clientId,
      kind: t.kind,
      original_kind: t.kind === 'deadhead' ? 'deadhead' : 'active',
      source: 'manual',
      started_at: t.startedAt,
      ended_at: t.endedAt,
      distance_m: t.distanceM,
      purpose: t.purpose,
      edited_at: at,
      sync_state: 'local',
    } as const;
    await this.d.db.runAsync(
      `INSERT INTO trips (trip_key, shift_client_id, kind, original_kind, source, started_at, ended_at, distance_m, purpose, edited_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
      key,
      clientId,
      row.kind,
      row.original_kind,
      row.started_at,
      row.ended_at,
      row.distance_m,
      row.purpose,
      at,
    );
    await this.queueManual(clientId, row, at);
    await this.move(clientId, null, t.kind, t.distanceM);
    return { ok: true };
  }

  async setOdometer(
    clientId: string,
    kind: 'shift_start' | 'shift_end',
    readingM: number,
  ): Promise<EditResult> {
    const bad = await this.guard(clientId);
    if (bad) return { ok: false, reason: bad };
    if (!Number.isFinite(readingM) || readingM < 0) return { ok: false, reason: 'invalid' };
    const at = this.stamp();
    await this.d.store.setOdometer(clientId, kind, readingM, at);
    await this.d.outbox.enqueue('odometer.put', `${clientId}:${kind}`, {
      reading_m: Math.round(readingM),
      recorded_at: at,
    });
    return { ok: true };
  }

  async setNotes(clientId: string, notes: string): Promise<EditResult> {
    const bad = await this.guard(clientId);
    if (bad) return { ok: false, reason: bad };
    if (notes.length > 1000) return { ok: false, reason: 'invalid' };
    const at = this.stamp();
    await this.d.db.runAsync(
      'UPDATE shifts SET notes = ?, updated_at = ? WHERE client_id = ?',
      notes,
      at,
      clientId,
    );
    await this.d.outbox.enqueue('shift.patch', clientId, { notes, updated_at: at });
    return { ok: true };
  }

  private queueManual(
    clientId: string,
    t: Pick<TripRow, 'trip_key' | 'kind' | 'started_at' | 'ended_at' | 'distance_m' | 'purpose'>,
    at: number,
  ) {
    return this.d.outbox.enqueue('trip.manual', `${clientId}:${t.trip_key}`, {
      kind: t.kind,
      started_at: t.started_at,
      ended_at: t.ended_at,
      distance_m: t.distance_m,
      purpose: t.purpose,
      edited_at: at,
    });
  }

  /**
   * Moves `distanceM` between the shift's active / deadhead / personal buckets (`from` null: a new
   * trip, `to` null: none). Only the difference is applied, so the engine's own rounding stays; the
   * server's numbers replace these on the next pull. A shift without phone totals is left alone.
   */
  private async move(clientId: string, from: TripKind | null, to: TripKind, distanceM: number) {
    const s = await this.d.store.get(clientId);
    if (!s || s.total_m === null) return;
    const col = { active: 'active_m', deadhead: 'deadhead_m', personal: 'personal_m' } as const;
    const v = {
      active_m: s.active_m ?? 0,
      deadhead_m: s.deadhead_m ?? 0,
      personal_m: s.personal_m ?? 0,
    };
    if (from) v[col[from]] -= distanceM;
    v[col[to]] += distanceM;
    await this.d.db.runAsync(
      'UPDATE shifts SET active_m = ?, deadhead_m = ?, personal_m = ?, total_m = ? WHERE client_id = ?',
      v.active_m,
      v.deadhead_m,
      v.personal_m,
      s.total_m + (from ? 0 : distanceM),
      clientId,
    );
  }
}
