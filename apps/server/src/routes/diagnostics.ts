import type { RouteHost } from '@milewage/shared';
import { validateEvent } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createSettingsRepository, type Db } from '../db';
import type { DiskState } from '../disk';
import type { DiagnosticsStore } from '../diagnostics/store';
import { strictObject } from './util';

// Each event is validated on its own, so a bad one is listed in `rejected` and never fails the batch.
const ingestBody = strictObject(
  { events: { type: 'array', minItems: 1, maxItems: 200, items: {} } },
  ['events'],
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
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  store: () => DiagnosticsStore;
  disk?: () => DiskState;
}) {
  return (host: RouteHost) => {
    const { app } = host as ServerRouteHost;
    const settings = createSettingsRepository(db);

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
        const setting = row?.diagnosticsLevel ?? 'basic';
        const level =
          setting === 'verbose' && (row?.diagnosticsVerboseUntil ?? 0) <= t ? 'basic' : setting;
        const result = {
          accepted: 0,
          duplicates: 0,
          discarded: 0,
          rejected: [] as { index: number; reason: Reason }[],
        };
        events.forEach((raw, index) => {
          const reject = (reason: Reason) => void result.rejected.push({ index, reason });
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
