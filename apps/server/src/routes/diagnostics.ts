import type { RouteHost } from '@milewage/shared';
import { validateEvent } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createSettingsRepository, type Db } from '../db';
import type { DiskState } from '../disk';
import { effectiveLevel } from '../diagnostics/recorder';
import type { DiagnosticsStore } from '../diagnostics/store';
import { ProblemError } from '../errors';
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
  now,
  authn,
  store,
  disk,
  onDrop,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  store: () => DiagnosticsStore;
  disk?: () => DiskState;
  /** Counts what ingest refused or discarded, for the server's own `diag.self`. */
  onDrop?: (reason: 'schema_reject' | 'level_off' | 'disk_low') => void;
}) {
  return (host: RouteHost) => {
    const { app } = host as ServerRouteHost;
    const settings = createSettingsRepository(db);

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
        const row = settings.get(principal.userId);
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
