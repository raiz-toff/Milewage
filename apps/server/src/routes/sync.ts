import type { EventSubscriptions, ModuleJob } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createOdometerRepository,
  createProcessingRepository,
  createShiftRepository,
  createSyncRepository,
  createVehicleRepository,
  type ChangeEntity,
  type ChangeRow,
  type Db,
} from '../db';
import { ProblemError } from '../errors';
import { odometerView } from './odometer';
import { presentShift } from '../processing/presenter';
import { tripView } from './shifts';
import { strictObject } from './util';
import { vehicleView } from './vehicles';

const DAY = 24 * 60 * 60 * 1000;
export const LOG_KEPT_MS = 30 * DAY;
const query = strictObject(
  {
    after: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
  [],
);

export interface SyncOptions {
  db: Db;
  now: () => number;
  authn: Authenticator;
  /** Core service: the `Settings` response for a user. */
  readSettings: (userId: number) => object;
}

/**
 * The pull path (08 section 6a, 15 section 6.5): the module listens for facts on the event bus and
 * keeps `change_log`; the route answers with the CURRENT state of each changed entity, so a log row
 * carries no data and a later change to the same key replaces an earlier one. With the module off
 * nothing here exists and the phone is upload-only.
 */
export function createSync({ db, now, authn, readSettings }: SyncOptions) {
  const log = createSyncRepository(db);
  const shifts = createShiftRepository(db);
  const processing = createProcessingRepository(db);
  const odometer = createOdometerRepository(db);
  const vehicles = createVehicleRepository(db);
  const userOf = (table: 'vehicles', id: string) =>
    db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).pluck().get(Number(id)) as
      number | undefined;

  const logShift = (shiftId: string) => {
    const shift = shifts.byId(Number(shiftId));
    if (!shift) return;
    const t = now();
    log.record(shift.userId, 'shift', shift.clientId, 'upsert', t);
    if (shift.calculatedAt === null) return;
    // Trips are derived and replaced on every run: log the current ones, and the keys that vanished.
    const current = new Set(processing.tripsOf(shift.id).map((x) => x.tripKey));
    for (const key of current) log.record(shift.userId, 'trip', key, 'upsert', t);
    for (const key of log.liveTripKeys(shift.userId, shift.clientId)) {
      if (!current.has(key)) log.record(shift.userId, 'trip', key, 'delete', t);
    }
    // Driver edits are re-sent after every run: one whose trip is gone arrives as `orphaned_override`.
    for (const o of processing.overridesOf(shift.id)) {
      log.record(shift.userId, 'override', o.tripKey, 'upsert', t);
    }
  };
  const subscriptions: EventSubscriptions = {
    'trip.updated'(p) {
      // A manual trip's key is its client id, so a deletion cannot be found by the shift's key prefix.
      if (!p.deleted || !p.tripKey) return;
      const shift = shifts.byId(Number(p.shiftId));
      if (shift) log.record(shift.userId, 'trip', p.tripKey, 'delete', now());
    },
    'shift.deleted'(p) {
      // The rows are gone: tombstones for the shift and for everything the phone may hold under it.
      const userId = Number(p.userId);
      const t = now();
      log.record(userId, 'shift', p.clientId, 'delete', t);
      for (const key of p.tripKeys) log.record(userId, 'trip', key, 'delete', t);
      for (const key of p.overrideKeys) log.record(userId, 'override', key, 'delete', t);
      for (const id of p.odometerIds) log.record(userId, 'odometer', id, 'delete', t);
    },
    'shift.started': (p) => logShift(p.shiftId),
    'shift.ended': (p) => logShift(p.shiftId),
    'shift.updated': (p) => logShift(p.shiftId),
    'shift.finalized': (p) => logShift(p.shiftId),
    'odometer.updated': (p) =>
      log.record(
        Number(p.userId),
        'odometer',
        p.odometerId,
        p.deleted ? 'delete' : 'upsert',
        now(),
      ),
    'vehicle.updated'(p) {
      const userId = userOf('vehicles', p.vehicleId);
      if (userId !== undefined) log.record(userId, 'vehicle', p.vehicleId, 'upsert', now());
    },
    'settings.updated': (p) =>
      log.record(Number(p.userId), 'settings', 'settings', 'upsert', now()),
    'edit.overwritten': (p) =>
      log.overwrite(
        Number(p.userId),
        now(),
        p.entity,
        p.key,
        JSON.stringify(p.superseded),
        p.deviceId === undefined ? null : Number(p.deviceId),
      ),
  };

  const routes = ({ app }: ServerRouteHost) => {
    /** The entity in its API shape, or null when it no longer exists (reported as a delete). */
    const dataOf = (userId: number, row: ChangeRow): object | null => {
      switch (row.entity) {
        case 'shift': {
          const s = shifts.byClientId(userId, row.key);
          return s ? presentShift(db, s) : null;
        }
        case 'trip': {
          const t = processing.tripByKey(userId, row.key);
          return t ? tripView(t) : null;
        }
        case 'odometer': {
          const r = odometer.byId(userId, Number(row.key));
          return r ? odometerView(r) : null;
        }
        case 'vehicle': {
          const v = vehicles.find(userId, Number(row.key));
          return v ? vehicleView(v) : null;
        }
        case 'override': {
          const o = processing.overrideByKey(userId, row.key);
          return o
            ? { trip_key: o.tripKey, kind: o.kind, purpose: o.purpose, edited_at: o.editedAt }
            : null;
        }
        case 'settings':
          return readSettings(userId);
        default:
          return null;
      }
    };
    /** The client_id of the shift an entry belongs to, when it belongs to one (for the device window). */
    const shiftOf = (userId: number, row: ChangeRow): string | undefined => {
      if (row.entity === 'shift') return row.key;
      if (row.entity === 'trip' || row.entity === 'override') {
        // Manual trips are keyed by a client id; the shift comes from the row while it exists.
        const t = processing.tripByKey(userId, row.key);
        if (t) return shifts.byId(t.shiftId)?.clientId;
        return row.key.includes(':') ? row.key.split(':')[0] : undefined;
      }
      if (row.entity === 'odometer') {
        const r = odometer.byId(userId, Number(row.key));
        return r?.shiftId == null ? undefined : shifts.byId(r.shiftId)?.clientId;
      }
      return undefined;
    };

    app.get('/sync/changes', { schema: { querystring: query } }, async (req) => {
      const p = authn.authenticate(req, 'SD');
      const q = req.query as { after?: number; limit?: number };
      const after = q.after ?? 0;
      const limit = q.limit ?? 200;
      if (log.expired(p.userId, after)) {
        throw new ProblemError(
          'cursor_expired',
          'The change log was pruned or the server was restored. Pull the whole window again.',
        );
      }
      const since = p.kind === 'device' ? now() - 14 * DAY : undefined;
      const visible = (row: ChangeRow) => {
        const client = since === undefined ? undefined : shiftOf(p.userId, row);
        if (client === undefined || shifts.byRef(p.userId, client, since) !== undefined)
          return true;
        // A purged shift is gone from the table: its tombstones must still reach the phone.
        return row.op === 'delete' && shifts.byClientId(p.userId, client) === undefined;
      };
      const kept: ChangeRow[] = [];
      let cursor = after;
      let more = false;
      for (;;) {
        const rows = log.after(p.userId, cursor, limit * 2);
        for (const row of rows) {
          if (kept.length >= limit) {
            more = true;
            break;
          }
          cursor = row.seq;
          if (visible(row)) kept.push(row);
        }
        if (more || rows.length < limit * 2) break;
      }
      if (!more) more = log.after(p.userId, cursor, 1).length > 0;
      // Each entry carries the current state, so an older entry for a key already in the page is redundant.
      const latest = new Map(kept.map((r) => [`${r.entity}/${r.key}`, r.seq]));
      const changes = kept
        .filter((r) => latest.get(`${r.entity}/${r.key}`) === r.seq)
        .map((r) => {
          const data = r.op === 'delete' ? null : dataOf(p.userId, r);
          const orphan =
            r.entity === 'override' && data !== null && !processing.tripByKey(p.userId, r.key);
          return {
            seq: r.seq,
            entity: r.entity,
            op: data === null ? 'delete' : orphan ? 'orphaned_override' : 'upsert',
            key: r.key,
            data,
          };
        });
      return { changes, next_cursor: cursor, has_more: more };
    });
  };

  const jobs: ModuleJob[] = [
    {
      name: 'change-log-prune',
      start() {
        const run = () => log.prune(now() - LOG_KEPT_MS);
        const timer = setInterval(run, DAY);
        timer.unref();
        return () => clearInterval(timer);
      },
    },
  ];
  return { routes, subscriptions, jobs, prune: () => log.prune(now() - LOG_KEPT_MS) };
}

export type { ChangeEntity };
