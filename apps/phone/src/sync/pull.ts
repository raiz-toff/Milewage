import type { components } from '@milewage/shared/generated/api-types';
import { ApiError } from '../api/client';
import type { AppSqlDb, SqlValue } from '../db/appDb';
import type { CachedSettings, Flags } from '../pairing/pairing';
import type { ApiClient } from '../api/client';
import { shiftOf, type Outbox, type OutboxItem } from './outbox';

type Schemas = components['schemas'];
type Change = Schemas['ChangeEntry'];

export type PullState = 'ok' | 'offline' | 'halted' | 'disabled' | 'not_paired' | 'skipped';

export interface PullResult {
  state: PullState;
  applied: number;
}

export interface PullDeps {
  db: AppSqlDb;
  outbox: Outbox;
  session: () => Promise<{ client: ApiClient; flags: Flags } | null>;
  /** The server's settings arrived through the feed (they drive the flags). */
  onSettings?: (s: CachedSettings) => void | Promise<void>;
  now?: () => number;
  /** Pulls closer together than this are skipped unless forced (15 section 6.5: every 5 minutes). */
  minIntervalMs?: number;
}

const CURSOR = 'changes_cursor';
const PAGE = 200;

/** `GET /sync/changes` into `app.db` (15 sections 6.5, 7, 8). The server's rows win; nothing is dropped silently. */
export class ChangePuller {
  private busy = false;
  private last = -Infinity;
  private readonly now: () => number;

  constructor(private readonly d: PullDeps) {
    this.now = d.now ?? Date.now;
  }

  async pull(opts: { force?: boolean } = {}): Promise<PullResult> {
    const none = (state: PullState): PullResult => ({ state, applied: 0 });
    if (this.busy) return none('skipped');
    if (!opts.force && this.now() - this.last < (this.d.minIntervalMs ?? 300_000)) {
      return none('skipped');
    }
    const s = await this.d.session();
    if (!s) return none('not_paired');
    if (!s.flags.sync) return none('disabled');
    this.busy = true;
    try {
      let applied = 0;
      let expired = false;
      for (;;) {
        const after = Number((await this.get(CURSOR)) ?? 0);
        let page: Schemas['SyncChanges'];
        try {
          page = (
            await s.client.request<Schemas['SyncChanges']>(
              'GET',
              `/sync/changes?after=${after}&limit=${PAGE}`,
            )
          ).data;
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          if (e.status === 410 && !expired) {
            // The server pruned its log (or was restored): pull the whole window again, upserting by key.
            expired = true;
            await this.set(CURSOR, '0');
            continue;
          }
          if (e.status === 401 || e.status === 403) return { state: 'halted', applied };
          return { state: 'offline', applied };
        }
        await this.d.db.withTransactionAsync(async () => {
          for (const c of page.changes) await this.apply(c);
          await this.set(CURSOR, String(page.next_cursor));
        });
        applied += page.changes.length;
        for (const c of page.changes) {
          if (c.entity === 'settings' && c.op === 'upsert' && c.data) {
            await this.d.onSettings?.(c.data as unknown as CachedSettings);
          }
        }
        if (!page.has_more) break;
      }
      this.last = this.now();
      await this.set('last_sync_at', String(this.last));
      return { state: 'ok', applied };
    } finally {
      this.busy = false;
    }
  }

  private async get(key: string): Promise<string | null> {
    const r = await this.d.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_state WHERE key = ?',
      key,
    );
    return r?.value ?? null;
  }

  private async set(key: string, value: string): Promise<void> {
    await this.d.db.runAsync(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  private run(sql: string, ...p: SqlValue[]) {
    return this.d.db.runAsync(sql, ...p);
  }

  private one<T>(sql: string, ...p: SqlValue[]) {
    return this.d.db.getFirstAsync<T>(sql, ...p);
  }

  /** Writes what the phone had to `conflict_log` before it is replaced or dropped (15 section 8.2). */
  private async log(
    entity: 'shift' | 'trip' | 'odometer',
    key: string,
    reason: 'superseded_by_server' | 'deleted_on_server' | 'recon_diff',
    local: unknown,
    server: unknown,
  ) {
    await this.run(
      'INSERT INTO conflict_log (at, entity, entity_key, reason, local_json, server_json) VALUES (?, ?, ?, ?, ?, ?)',
      this.now(),
      entity,
      key,
      reason,
      JSON.stringify(local),
      server === null ? null : JSON.stringify(server),
    );
  }

  private async unsent(
    kind: OutboxItem['kind'],
    shift: string,
    match?: (i: OutboxItem) => boolean,
  ) {
    return (await this.d.outbox.pending()).filter(
      (i) => i.kind === kind && shiftOf(i.entityKey) === shift && (!match || match(i)),
    );
  }

  private async dropItems(items: OutboxItem[]) {
    for (const i of items) await this.run('DELETE FROM outbox WHERE id = ?', i.id);
  }

  private async clientIdOf(serverId: number): Promise<string | null> {
    const r = await this.one<{ client_id: string }>(
      'SELECT client_id FROM shifts WHERE server_id = ?',
      serverId,
    );
    return r?.client_id ?? null;
  }

  private async apply(c: Change): Promise<void> {
    switch (c.entity) {
      case 'shift':
        return c.op === 'delete'
          ? this.deleteShift(c.key)
          : this.upsertShift(c.data as unknown as Schemas['Shift']);
      case 'trip':
        return c.op === 'delete'
          ? this.deleteTrip(c.key)
          : this.upsertTrip(c.data as unknown as Schemas['Trip']);
      case 'override':
        return this.override(c);
      case 'odometer':
        return c.op === 'delete'
          ? this.deleteOdometer(Number(c.key))
          : this.upsertOdometer(c.data as unknown as Schemas['OdometerReading']);
      case 'vehicle':
        return c.op === 'delete'
          ? void (await this.run('DELETE FROM vehicles WHERE server_id = ?', Number(c.key)))
          : this.upsertVehicle(c.data as unknown as Schemas['Vehicle']);
      default:
        return; // settings are handed to `onSettings` after the page is stored
    }
  }

  private async upsertVehicle(v: Schemas['Vehicle']) {
    await this.run(
      `INSERT INTO vehicles (server_id, name, kind, archived_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET name = excluded.name, kind = excluded.kind, archived_at = excluded.archived_at`,
      v.id,
      v.name,
      v.kind,
      v.archived_at,
    );
  }

  private async upsertShift(s: Schemas['Shift']) {
    const local = await this.one<{
      client_id: string;
      total_m: number | null;
      active_m: number | null;
      deadhead_m: number | null;
      personal_m: number | null;
      calc_version: number | null;
      notes: string | null;
      vehicle_id: number;
      updated_at: number;
    }>('SELECT * FROM shifts WHERE client_id = ?', s.client_id);
    const reasons = JSON.stringify(s.recon_reasons ?? []);
    if (!local) {
      await this.run(
        `INSERT INTO shifts (client_id, server_id, vehicle_id, status, segmenter, started_at, ended_at, local_date,
           total_m, active_m, deadhead_m, personal_m, calc_version, calc_source, server_total_m, recon_status,
           recon_reasons, notes, updated_at, sync_state, server_deduction_cents, server_deduction_known)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'server', ?, ?, ?, ?, ?, 'on_server', ?, 1)`,
        s.client_id,
        s.id,
        s.vehicle_id,
        s.status,
        s.segmenter,
        s.started_at,
        s.ended_at,
        s.local_date,
        s.total_m,
        s.active_m,
        s.deadhead_m,
        s.personal_m,
        s.calc_version,
        s.total_m,
        s.recon_status ?? 'pending',
        reasons,
        s.notes,
        s.updated_at ?? this.now(),
        s.deduction_cents ?? null,
      );
      return;
    }
    // The phone is still the only holder of this shift's end or create: its own queue decides, not the feed.
    if (
      (await this.d.outbox.has('shift.create', s.client_id)) ||
      (await this.d.outbox.has('shift.end', s.client_id))
    ) {
      await this.run('UPDATE shifts SET server_id = ? WHERE client_id = ?', s.id, s.client_id);
      return;
    }
    let notes = s.notes;
    let vehicle = s.vehicle_id;
    let updatedAt = s.updated_at ?? local.updated_at;
    const patches = await this.unsent('shift.patch', s.client_id);
    if (patches.length > 0) {
      const mine = Math.max(...patches.map((p) => Number(p.body.updated_at ?? 0)));
      if (mine > (s.updated_at ?? 0)) {
        // The phone's edit is strictly newer: it keeps its value and wins when it is sent.
        notes = local.notes;
        vehicle = local.vehicle_id;
        updatedAt = local.updated_at;
      } else {
        await this.log(
          'shift',
          s.client_id,
          'superseded_by_server',
          { patches: patches.map((p) => p.body) },
          { notes: s.notes, vehicle_id: s.vehicle_id },
        );
        await this.dropItems(patches);
      }
    }
    const changed = local.total_m !== null && s.total_m !== null && local.total_m !== s.total_m;
    if (changed) {
      await this.log(
        'shift',
        s.client_id,
        'recon_diff',
        {
          total_m: local.total_m,
          active_m: local.active_m,
          deadhead_m: local.deadhead_m,
          personal_m: local.personal_m,
          calc_version: local.calc_version,
        },
        {
          total_m: s.total_m,
          active_m: s.active_m,
          deadhead_m: s.deadhead_m,
          personal_m: s.personal_m,
          calc_version: s.calc_version,
          reasons: s.recon_reasons ?? [],
        },
      );
    }
    await this.run(
      `UPDATE shifts SET server_id = ?, vehicle_id = ?, status = ?, ended_at = ?, local_date = ?,
         total_m = COALESCE(?, total_m), active_m = COALESCE(?, active_m), deadhead_m = COALESCE(?, deadhead_m),
         personal_m = COALESCE(?, personal_m), calc_version = COALESCE(?, calc_version), calc_source = 'server',
         server_total_m = ?, recon_status = ?, recon_reasons = ?, notes = ?, updated_at = ?,
         server_deduction_cents = ?, server_deduction_known = 1,
         sync_state = CASE WHEN sync_state = 'needs_attention' THEN sync_state ELSE 'on_server' END
       WHERE client_id = ?`,
      s.id,
      vehicle,
      s.status,
      s.ended_at,
      s.local_date,
      s.total_m,
      s.active_m,
      s.deadhead_m,
      s.personal_m,
      s.calc_version,
      s.total_m,
      s.recon_status ?? 'pending',
      reasons,
      notes,
      updatedAt,
      s.deduction_cents ?? null,
      s.client_id,
    );
  }

  /** A shift purged on the web: the server's delete wins, and unsynced local edits go to the log first. */
  private async deleteShift(clientId: string) {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM shifts WHERE client_id = ?',
      clientId,
    );
    if (!row) return;
    const queued = (await this.d.outbox.pending()).filter((i) => shiftOf(i.entityKey) === clientId);
    if (queued.length > 0) {
      await this.log(
        'shift',
        clientId,
        'deleted_on_server',
        { shift: row, queued: queued.map((q) => [q.kind, q.body]) },
        null,
      );
    }
    await this.d.outbox.dropShift(clientId);
    await this.run('DELETE FROM shifts WHERE client_id = ?', clientId);
  }

  private async tripShift(t: Schemas['Trip']): Promise<string | null> {
    if (t.trip_key?.includes(':')) return t.trip_key.split(':')[0]!;
    return this.clientIdOf(t.shift_id);
  }

  private async upsertTrip(t: Schemas['Trip']) {
    const shift = await this.tripShift(t);
    const key = t.trip_key;
    if (!shift || !key) return;
    if (!(await this.one('SELECT 1 AS x FROM shifts WHERE client_id = ?', shift))) return;
    const pending = await this.unsent(
      t.source === 'manual' ? 'trip.manual' : 'trip.override',
      shift,
      (i) => (t.source === 'manual' ? i.entityKey === `${shift}:${key}` : i.entityKey === key),
    );
    if (pending.length > 0) {
      const mine = Math.max(...pending.map((p) => Number(p.body.edited_at ?? 0)));
      if (mine > (t.edited_at ?? 0)) return; // the phone's edit is strictly newer and still going up
      await this.log(
        'trip',
        key,
        'superseded_by_server',
        { pending: pending.map((p) => p.body) },
        { kind: t.kind, purpose: t.purpose, edited_at: t.edited_at },
      );
      await this.dropItems(pending);
    }
    await this.run(
      `INSERT INTO trips (trip_key, server_id, shift_client_id, kind, original_kind, source, started_at, ended_at,
         start_lat_e7, start_lon_e7, end_lat_e7, end_lon_e7, distance_m, purpose, edited_at, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'on_server')
       ON CONFLICT(trip_key) DO UPDATE SET server_id = excluded.server_id, kind = excluded.kind,
         original_kind = excluded.original_kind, started_at = excluded.started_at, ended_at = excluded.ended_at,
         start_lat_e7 = excluded.start_lat_e7, start_lon_e7 = excluded.start_lon_e7,
         end_lat_e7 = excluded.end_lat_e7, end_lon_e7 = excluded.end_lon_e7, distance_m = excluded.distance_m,
         purpose = excluded.purpose, edited_at = excluded.edited_at, sync_state = 'on_server'`,
      key,
      t.id,
      shift,
      t.kind,
      t.original_kind,
      t.source,
      t.started_at,
      t.ended_at,
      t.start_lat_e7 ?? null,
      t.start_lon_e7 ?? null,
      t.end_lat_e7 ?? null,
      t.end_lon_e7 ?? null,
      t.distance_m,
      t.purpose,
      t.edited_at,
    );
  }

  private async deleteTrip(key: string) {
    const row = await this.one<{ shift_client_id: string; source: string }>(
      'SELECT shift_client_id, source FROM trips WHERE trip_key = ?',
      key,
    );
    if (!row) return;
    const pending = (await this.d.outbox.pending()).filter(
      (i) => i.entityKey === key || i.entityKey === `${row.shift_client_id}:${key}`,
    );
    if (pending.length > 0) {
      await this.log(
        'trip',
        key,
        'deleted_on_server',
        { pending: pending.map((p) => p.body) },
        null,
      );
      await this.dropItems(pending);
    }
    await this.run('DELETE FROM trips WHERE trip_key = ?', key);
  }

  /** A driver edit the server holds. An orphan (no trip carries the key any more) is reported, never dropped. */
  private async override(c: Change) {
    if (c.op === 'delete' || !c.data) return;
    const o = c.data as unknown as {
      trip_key: string;
      kind: string;
      purpose: string;
      edited_at: number;
    };
    if (c.op === 'orphaned_override') {
      const trip = await this.one('SELECT * FROM trips WHERE trip_key = ?', c.key);
      await this.log('trip', c.key, 'superseded_by_server', trip ?? { trip_key: c.key }, {
        orphaned: true,
        ...o,
      });
    }
  }

  private async upsertOdometer(r: Schemas['OdometerReading']) {
    if (r.shift_id === null || (r.kind !== 'shift_start' && r.kind !== 'shift_end')) return;
    const shift = await this.clientIdOf(r.shift_id);
    if (!shift) return;
    const pending = await this.unsent(
      'odometer.put',
      shift,
      (i) => i.entityKey === `${shift}:${r.kind}`,
    );
    if (pending.length > 0) {
      const mine = Math.max(...pending.map((p) => Number(p.body.recorded_at ?? 0)));
      if (mine > r.recorded_at) return;
      await this.log(
        'odometer',
        `${shift}:${r.kind}`,
        'superseded_by_server',
        { pending: pending.map((p) => p.body) },
        { reading_m: r.reading_m, recorded_at: r.recorded_at },
      );
      await this.dropItems(pending);
    }
    await this.run(
      `INSERT INTO odometer_readings (shift_client_id, kind, reading_m, recorded_at, sync_state, server_id)
       VALUES (?, ?, ?, ?, 'on_server', ?)
       ON CONFLICT(shift_client_id, kind) DO UPDATE SET reading_m = excluded.reading_m,
         recorded_at = excluded.recorded_at, sync_state = 'on_server', server_id = excluded.server_id`,
      shift,
      r.kind,
      r.reading_m,
      r.recorded_at,
      r.id,
    );
  }

  private async deleteOdometer(serverId: number) {
    const row = await this.one<{ shift_client_id: string; kind: string }>(
      'SELECT shift_client_id, kind FROM odometer_readings WHERE server_id = ?',
      serverId,
    );
    if (!row) return;
    const key = `${row.shift_client_id}:${row.kind}`;
    const pending = (await this.d.outbox.pending()).filter((i) => i.entityKey === key);
    if (pending.length > 0) {
      await this.log(
        'odometer',
        key,
        'deleted_on_server',
        { pending: pending.map((p) => p.body) },
        null,
      );
      await this.dropItems(pending);
    }
    await this.run('DELETE FROM odometer_readings WHERE server_id = ?', serverId);
  }
}
