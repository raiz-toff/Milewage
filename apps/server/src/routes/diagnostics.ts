import { DIAGNOSED_MODULES, validateEvent } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { type Db } from '../db';
import type { DriverContexts } from '../driver-context';
import type { DiskState } from '../disk';
import { effectiveLevel } from '../diagnostics/recorder';
import type { DiagnosticsStore } from '../diagnostics/store';
import { ProblemError } from '../errors';
import { gzipSync } from 'node:zlib';
import { algorithmVersion } from '@milewage/track-engine';
import { buildBundle } from '../diagnostics/bundle';
import { deviceHealth, serverHealth } from '../diagnostics/health';
import { createProcessingRepository, createShiftRepository } from '../db';
import { SERVER_VERSION } from '../version';
import { strictObject } from './util';

// Each event is validated on its own, so a bad one is listed in `rejected` and never fails the batch.
const ingestBody = strictObject(
  { events: { type: 'array', minItems: 1, maxItems: 200, items: {} } },
  ['events'],
);

const listQuery = strictObject(
  {
    from_at: { type: 'integer', minimum: 0 },
    to_at: { type: 'integer', minimum: 0 },
    kind: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
    src: { enum: ['phone_native', 'phone_js', 'server', 'web'] },
    device_id: { type: 'integer', minimum: 1 },
    shift: { type: 'string', format: 'uuid' },
    level: { enum: ['basic', 'verbose'] },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    cursor: { type: 'string', minLength: 1, maxLength: 200 },
  },
  [],
);

type Reason = 'unknown_kind' | 'schema' | 'pattern' | 'level' | 'scope' | 'seq_required';

/** Maps the shared validator's path-only reason onto the API's reject enum (08 DiagIngestResult). */
function reasonOf(text: string): Reason {
  if (text.startsWith('event.kind: unknown')) return 'unknown_kind';
  if (text.startsWith('event.level')) return 'level';
  if (text.startsWith('event.src')) return 'scope';
  if (/not an id|not a version|field not allowed|not an epoch/.test(text)) return 'pattern';
  return 'schema';
}

/** `POST /diagnostics/events` (16 section 7.2): devices send phone sources, a web session sends `web`. */
export function diagnosticsRoutes({
  db,
  drivers,
  now,
  authn,
  store,
  disk,
  onDrop,
  observe,
  lastBackupAt,
  bundle = true,
}: {
  db: Db;
  drivers: DriverContexts;
  now: () => number;
  authn: Authenticator;
  store: () => DiagnosticsStore;
  disk?: () => DiskState;
  /** Counts what ingest refused or discarded, for the server's own `diag.self`. */
  onDrop?: (reason: 'schema_reject' | 'level_off' | 'disk_low') => void;
  /** `diagnostics.bundle` (default on): the debug-bundle route exists. */
  bundle?: boolean;
  /** Creation time of the newest verified backup, for check S3. */
  lastBackupAt?: () => number | undefined;
  /** Installs the request counters of `api.window` on the app. */
  observe?: (app: ServerRouteHost['app']) => void;
}) {
  return ({ app, registry }: ServerRouteHost) => {
    observe?.(app);

    app.get('/diagnostics/events', { schema: { querystring: listQuery } }, async (req) => {
      const p = authn.authenticate(req, 'S');
      const q = req.query as {
        from_at?: number;
        to_at?: number;
        kind?: string[];
        src?: string;
        device_id?: number;
        shift?: string;
        level?: string;
        limit?: number;
        cursor?: string;
      };
      let after: { at: number; id: number } | undefined;
      if (q.cursor) {
        try {
          const [at, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as number[];
          if (!Number.isInteger(at) || !Number.isInteger(id)) throw new Error('shape');
          after = { at: at!, id: id! };
        } catch {
          throw new ProblemError('validation_failed', 'The request is not valid.', [
            { path: '/cursor', message: 'is not a cursor from this server' },
          ]);
        }
      }
      const limit = q.limit ?? 50;
      const rows = store().list(p.userId, {
        fromAt: q.from_at,
        toAt: q.to_at,
        kinds: q.kind,
        src: q.src,
        deviceId: q.device_id,
        shift: q.shift?.toLowerCase(),
        level: q.level,
        after,
        limit,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          src: r.src,
          device_id: r.deviceId,
          seq: r.seq,
          at: r.at,
          received_at: r.receivedAt,
          level: r.level,
          kind: r.kind,
          shift: r.shift,
          cap: r.cap,
          v: r.v,
          data: r.data,
        })),
        next_cursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify([last.at, last.id])).toString('base64url')
            : null,
      };
    });

    const healthOf = (p: { userId: number }) => {
      const t = now();
      const day = t - 24 * 3600_000;
      const devices = db
        .prepare(
          'SELECT id, name FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY id',
        )
        .all(p.userId) as { id: number; name: string }[];
      const kinds = [
        'track.window',
        'service.event',
        'upload.window',
        'perm.state',
        'shift.summary',
      ];
      const recon = store().list(p.userId, { kinds: ['recon.result'], src: 'server', limit: 500 });
      const out = devices.map((d) => {
        const h = deviceHealth(
          store().list(p.userId, { deviceId: d.id, kinds, limit: 5000 }),
          recon,
        );
        return {
          device_id: d.id,
          name: d.name,
          shifts_considered: h.shiftsConsidered,
          score: h.score,
          state: h.state,
          checks: h.checks,
        };
      });
      const last = lastBackupAt?.();
      const server = serverHealth(
        store().list(p.userId, {
          kinds: ['server.sample'],
          src: 'server',
          fromAt: day,
          limit: 200,
        }),
        store().list(p.userId, { kinds: ['api.window'], src: 'server', fromAt: day, limit: 1000 }),
        last === undefined ? null : t - last,
        disk?.() ?? 'ok',
      );
      return { generated_at: t, devices: out, server };
    };
    app.get('/diagnostics/health', async (req) => healthOf(authn.authenticate(req, 'S')));

    const bundleQuery = strictObject(
      {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        shift: { type: 'string', format: 'uuid' },
        include_capture: { type: 'integer', minimum: 1 },
      },
      [],
    );
    if (bundle) {
      app.get(
        '/diagnostics/bundle',
        { schema: { querystring: bundleQuery } },
        async (req, reply) => {
          const p = authn.authenticate(req, 'S');
          const q = req.query as {
            from?: string;
            to?: string;
            shift?: string;
            include_capture?: number;
          };
          if (q.include_capture !== undefined) {
            throw new ProblemError('validation_failed', 'The request is not valid.', [
              { path: '/include_capture', message: 'capture sessions are not available' },
            ]);
          }
          const shiftRepo = createShiftRepository(db);
          const rows = q.shift
            ? [shiftRepo.byRef(p.userId, q.shift.toLowerCase())].filter((r) => r !== undefined)
            : shiftRepo.list(p.userId, { from: q.from, to: q.to, limit: 20 }).slice(0, 20);
          if (q.shift && rows.length === 0)
            throw new ProblemError('shift_not_found', 'No such shift.');
          const flags = createProcessingRepository(db).flagsOf(rows.map((r) => r.id));
          const t = now();
          const start = rows.length
            ? Math.min(...rows.map((r) => r.startedAt)) - 3600_000
            : t - 14 * 24 * 3600_000;
          const events = store().list(p.userId, {
            fromAt: start,
            shift: q.shift?.toLowerCase(),
            limit: 5000,
          });
          const body = buildBundle({
            events,
            shifts: rows.map((r) => ({
              clientId: r.clientId,
              startedAt: r.startedAt,
              endedAt: r.endedAt,
              totalM: r.totalM,
              activeM: r.activeM,
              deadheadM: r.deadheadM,
              segmenter: r.segmenter,
              calcVersion: r.calcVersion,
              reconStatus: r.reconStatus,
              flags: (flags.get(r.id) ?? []).map((f) => f.code),
            })),
            versions: {
              app: SERVER_VERSION,
              engine: algorithmVersion,
              schema: String(db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()),
              sqlite: String(db.prepare('SELECT sqlite_version()').pluck().get()),
              node: process.versions.node,
            },
            modules: Object.fromEntries(DIAGNOSED_MODULES.map((m) => [m, registry.isEnabled(m)])),
            health: healthOf(p),
          });
          return reply
            .header('Content-Type', 'application/gzip')
            .header('Content-Disposition', 'attachment; filename="milewage-debug-bundle.json.gz"')
            .send(gzipSync(JSON.stringify(body)));
        },
      );
    }

    app.post(
      '/diagnostics/events',
      {
        config: { maxEncoded: 256 * 1024, rateLimit: 'diagnostics' },
        bodyLimit: 1024 * 1024,
        schema: { body: ingestBody },
      },
      async (req) => {
        const principal = authn.authenticate(req, 'SD');
        const device = principal.kind === 'device';
        const events = (req.body as { events: unknown[] }).events;
        const t = now();
        const row = drivers.of(principal.userId).settings;
        const level = effectiveLevel(row, t);
        const result = {
          accepted: 0,
          duplicates: 0,
          discarded: 0,
          rejected: [] as { index: number; reason: Reason }[],
        };
        events.forEach((raw, index) => {
          const reject = (reason: Reason) => {
            result.rejected.push({ index, reason });
            onDrop?.('schema_reject');
          };
          const checked = validateEvent(raw);
          if (!checked.ok) return reject(reasonOf(checked.reason));
          const e = checked.event;
          const allowed = device
            ? e.src === 'phone_native' || e.src === 'phone_js'
            : e.src === 'web';
          if (!allowed) return reject('scope');
          if (device && e.seq === undefined) return reject('seq_required');
          // `off` records nothing; `verbose` events are kept only while the level is verbose and the
          // disk is not low (accepted and discarded, 16 section 7.2).
          const lowDisk = e.level === 'verbose' && disk !== undefined && disk() !== 'ok';
          if (level === 'off' || lowDisk || (e.level === 'verbose' && level !== 'verbose')) {
            onDrop?.(lowDisk ? 'disk_low' : 'level_off');
            return void result.discarded++;
          }
          const stored = store().insert({
            userId: principal.userId,
            deviceId: device ? principal.deviceId : null,
            receivedAt: t,
            event: e,
          });
          if (stored) result.accepted++;
          else result.duplicates++;
        });
        // Counts only: an event body is never logged (16 section 4).
        req.log.info({ ...result, rejected: result.rejected.length }, 'diagnostics batch');
        return result;
      },
    );
  };
}
