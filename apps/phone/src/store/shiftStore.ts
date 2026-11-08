import type { ShiftResult } from '@milewage/track-engine';
import type { AppSqlDb } from '../db/appDb';

/** The calendar date (`YYYY-MM-DD`) of an instant in an IANA zone; never the device zone (15 section 10). */
export function localDate(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

export type SyncState = 'local' | 'syncing' | 'on_server' | 'needs_attention';

export interface ShiftRow {
  client_id: string;
  server_id: number | null;
  vehicle_id: number;
  status: 'active' | 'ended' | 'finalized';
  segmenter: 'stops' | 'whole_shift';
  started_at: number;
  ended_at: number | null;
  local_date: string;
  total_m: number | null;
  active_m: number | null;
  deadhead_m: number | null;
  personal_m: number | null;
  calc_version: number | null;
  input_digest: string | null;
  flags_json: string | null;
  calc_source: 'phone' | 'server';
  server_total_m: number | null;
  recon_status: 'pending' | 'match' | 'differs' | 'phone_missing';
  recon_reasons: string | null;
  first_seq: number | null;
  last_seq: number | null;
  point_count: number | null;
  route_geojson: string | null;
  notes: string | null;
  updated_at: number;
  sync_state: SyncState;
  /** The server's deduction value from the pull feed; only meaningful when `server_deduction_known` is 1. */
  server_deduction_cents: number | null;
  server_deduction_known: 0 | 1;
}

export interface TripRow {
  trip_key: string;
  shift_client_id: string;
  kind: 'active' | 'deadhead' | 'personal';
  original_kind: 'active' | 'deadhead';
  source: 'auto' | 'manual';
  started_at: number;
  ended_at: number;
  distance_m: number;
  purpose: string;
  edited_at: number | null;
  sync_state: string;
}

export interface StopRow {
  stop_key: string;
  shift_client_id: string;
  started_at: number;
  ended_at: number;
  dwell_s: number;
  lat_e7: number;
  lon_e7: number;
  confidence: 'low' | 'medium' | 'high';
  est_role: 'pickup' | 'dropoff' | 'none';
  role: 'pickup' | 'dropoff' | 'other' | 'none';
}

export interface OdometerRow {
  shift_client_id: string;
  kind: 'shift_start' | 'shift_end';
  reading_m: number;
  recorded_at: number;
}

export interface ConflictRow {
  id: number;
  at: number;
  entity: 'shift' | 'trip' | 'odometer';
  entity_key: string;
  reason: string;
  local_json: string;
  server_json: string | null;
  seen: number;
}

export interface BeginShift {
  clientId: string;
  vehicleId: number;
  segmenter: 'stops' | 'whole_shift';
  startedAt: number;
  timeZone: string;
}

export interface FinishShift {
  clientId: string;
  endedAt: number;
  /** The phone's own run of the shared engine; null when it threw (the server will calculate). */
  result: ShiftResult | null;
  manifest: { firstSeq: number; lastSeq: number; pointCount: number } | null;
}

/** The server's `Shift` as returned by `POST /shifts/{ref}/end`, as far as the phone stores it. */
export interface ServerShift {
  id: number;
  total_m: number | null;
  active_m: number | null;
  deadhead_m: number | null;
  personal_m: number | null;
  calc_version: number | null;
  recon_status?: 'pending' | 'match' | 'differs' | 'phone_missing';
  recon_reasons?: string[];
}

export interface ServerRecon {
  status: 'match' | 'differs' | 'phone_missing';
  server_total_m?: number;
  diff_m?: number;
  reasons: string[];
}

/** A route as a GeoJSON `LineString` in degrees (lon, lat), from the engine's simplified route. */
export function routeGeoJson(route: ShiftResult['route']): string | null {
  if (route.length < 2) return null;
  return JSON.stringify({
    type: 'LineString',
    coordinates: route.map((p) => [p.lonE7 / 1e7, p.latE7 / 1e7]),
  });
}

/** Shifts, trips, stops and odometer readings on the phone (15 section 2.2). */
export class ShiftStore {
  constructor(
    private readonly db: AppSqlDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** A shift row at the moment recording starts (idempotent). */
  async begin(a: BeginShift): Promise<void> {
    await this.db.runAsync(
      `INSERT OR IGNORE INTO shifts (client_id, vehicle_id, status, segmenter, started_at, local_date, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      a.clientId,
      a.vehicleId,
      a.segmenter,
      a.startedAt,
      localDate(a.startedAt, a.timeZone),
      this.now(),
    );
  }

  /**
   * Ends the shift locally: status, the phone's totals, trips, stops and route, all in one
   * transaction. Totals are stamped `calc_source = 'phone'` ("Calculated on phone") until the
   * server answers. Running it again for an ended shift changes nothing.
   */
  async finish(a: FinishShift): Promise<void> {
    const r = a.result;
    await this.db.withTransactionAsync(async () => {
      const cur = await this.get(a.clientId);
      if (!cur || cur.status !== 'active') return;
      await this.db.runAsync(
        `UPDATE shifts SET status = 'ended', ended_at = ?, total_m = ?, active_m = ?, deadhead_m = ?,
           personal_m = ?, calc_version = ?, input_digest = ?, flags_json = ?, calc_source = 'phone',
           first_seq = ?, last_seq = ?, point_count = ?, route_geojson = ?, updated_at = ? WHERE client_id = ?`,
        a.endedAt,
        r?.totals.totalM ?? null,
        r?.totals.activeM ?? null,
        r?.totals.deadheadM ?? null,
        r?.totals.personalM ?? null,
        r?.algorithmVersion ?? null,
        r?.inputDigest ?? null,
        r ? JSON.stringify(r.flags) : null,
        a.manifest?.firstSeq ?? null,
        a.manifest?.lastSeq ?? null,
        a.manifest?.pointCount ?? null,
        r ? routeGeoJson(r.route) : null,
        this.now(),
        a.clientId,
      );
      for (const t of r?.trips ?? []) {
        await this.db.runAsync(
          `INSERT OR REPLACE INTO trips (trip_key, shift_client_id, kind, original_kind, source, started_at, ended_at,
             start_lat_e7, start_lon_e7, end_lat_e7, end_lon_e7, distance_m, purpose)
           VALUES (?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.tripKey,
          a.clientId,
          t.kind,
          t.originalKind,
          t.startedAt,
          t.endedAt,
          t.startLatE7,
          t.startLonE7,
          t.endLatE7,
          t.endLonE7,
          t.distanceM,
          t.purpose,
        );
      }
      if (cur.segmenter === 'stops') {
        for (const s of r?.stops ?? []) {
          await this.db.runAsync(
            `INSERT OR REPLACE INTO stops (stop_key, shift_client_id, started_at, ended_at, dwell_s, lat_e7, lon_e7,
               confidence, est_role, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            s.stopKey,
            a.clientId,
            s.startedAt,
            s.endedAt,
            s.dwellS,
            s.latE7,
            s.lonE7,
            s.confidence,
            s.estRole,
            s.role,
          );
        }
      }
    });
  }

  async get(clientId: string): Promise<ShiftRow | null> {
    return this.db.getFirstAsync<ShiftRow>('SELECT * FROM shifts WHERE client_id = ?', clientId);
  }

  /** Newest first. */
  async list(limit = 200): Promise<ShiftRow[]> {
    return this.db.getAllAsync<ShiftRow>(
      'SELECT * FROM shifts ORDER BY started_at DESC LIMIT ?',
      limit,
    );
  }

  async trips(clientId: string): Promise<TripRow[]> {
    return this.db.getAllAsync<TripRow>(
      'SELECT * FROM trips WHERE shift_client_id = ? ORDER BY started_at, trip_key',
      clientId,
    );
  }

  async stops(clientId: string): Promise<StopRow[]> {
    return this.db.getAllAsync<StopRow>(
      'SELECT * FROM stops WHERE shift_client_id = ? ORDER BY started_at',
      clientId,
    );
  }

  async odometer(clientId: string): Promise<OdometerRow[]> {
    return this.db.getAllAsync<OdometerRow>(
      'SELECT shift_client_id, kind, reading_m, recorded_at FROM odometer_readings WHERE shift_client_id = ?',
      clientId,
    );
  }

  /** When this vehicle's odometer was last read, on any shift (the phone's or the server's); or null. */
  async lastOdometerAt(vehicleId: number): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ at: number | null }>(
      `SELECT MAX(o.recorded_at) AS at FROM odometer_readings o
       JOIN shifts s ON s.client_id = o.shift_client_id WHERE s.vehicle_id = ?`,
      vehicleId,
    );
    return row?.at ?? null;
  }

  async setOdometer(
    clientId: string,
    kind: 'shift_start' | 'shift_end',
    readingM: number,
    recordedAt: number,
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO odometer_readings (shift_client_id, kind, reading_m, recorded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(shift_client_id, kind) DO UPDATE SET reading_m = excluded.reading_m,
         recorded_at = excluded.recorded_at, sync_state = 'local'`,
      clientId,
      kind,
      Math.round(readingM),
      recordedAt,
    );
  }

  /** Unseen differences the server made (15 section 7.4), newest first. */
  async conflicts(clientId: string): Promise<ConflictRow[]> {
    return this.db.getAllAsync<ConflictRow>(
      'SELECT * FROM conflict_log WHERE seen = 0 AND (entity_key = ? OR entity_key LIKE ?) ORDER BY id DESC',
      clientId,
      `${clientId}:%`,
    );
  }

  async markSeen(id: number): Promise<void> {
    await this.db.runAsync('UPDATE conflict_log SET seen = 1 WHERE id = ?', id);
  }

  /** Vehicle kinds by server id (the cached `vehicles` table); empty until the first pull. */
  async vehicleKinds(): Promise<Map<number, string>> {
    const rows = await this.db.getAllAsync<{ server_id: number; kind: string }>(
      'SELECT server_id, kind FROM vehicles',
    );
    return new Map(rows.map((r) => [r.server_id, r.kind]));
  }

  async setSyncState(clientId: string, state: SyncState): Promise<void> {
    await this.db.runAsync('UPDATE shifts SET sync_state = ? WHERE client_id = ?', state, clientId);
  }

  /**
   * The server answered `shift.end` (15 section 7): its numbers are the ones shown from now on.
   * With a reconciliation the shift is `on_server`; a difference keeps the phone's numbers in the
   * `conflict_log` (`recon_diff`) so nothing is overwritten silently.
   */
  async applyEnd(clientId: string, shift: ServerShift, recon: ServerRecon | null): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      const cur = await this.get(clientId);
      if (!cur) return;
      const server = {
        total_m: shift.total_m,
        active_m: shift.active_m,
        deadhead_m: shift.deadhead_m,
        personal_m: shift.personal_m,
        calc_version: shift.calc_version,
      };
      if (recon?.status === 'differs') {
        await this.db.runAsync(
          `INSERT INTO conflict_log (at, entity, entity_key, reason, local_json, server_json)
           VALUES (?, 'shift', ?, 'recon_diff', ?, ?)`,
          this.now(),
          clientId,
          JSON.stringify({
            total_m: cur.total_m,
            active_m: cur.active_m,
            deadhead_m: cur.deadhead_m,
            personal_m: cur.personal_m,
            calc_version: cur.calc_version,
          }),
          JSON.stringify({ ...server, reasons: recon.reasons }),
        );
      }
      await this.db.runAsync(
        `UPDATE shifts SET server_id = ?, total_m = COALESCE(?, total_m), active_m = COALESCE(?, active_m),
           deadhead_m = COALESCE(?, deadhead_m), personal_m = COALESCE(?, personal_m),
           calc_version = COALESCE(?, calc_version), calc_source = 'server', server_total_m = ?,
           recon_status = ?, recon_reasons = ?, sync_state = 'on_server', updated_at = ? WHERE client_id = ?`,
        shift.id,
        server.total_m,
        server.active_m,
        server.deadhead_m,
        server.personal_m,
        server.calc_version,
        shift.total_m,
        recon?.status ?? shift.recon_status ?? 'phone_missing',
        JSON.stringify(recon?.reasons ?? shift.recon_reasons ?? []),
        this.now(),
        clientId,
      );
    });
  }

  /** Drops a shift that never reached the server (its children go with it). */
  async remove(clientId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM shifts WHERE client_id = ?', clientId);
  }
}
