import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import type { BackupRunRow } from '../db';
import { BackupError } from '../backup/engine';
import type { BackupService } from '../backup/service';
import { ProblemError } from '../errors';

const MIN_GAP_MS = 15 * 60 * 1000;

/** The `Backup` object of 08. */
export const toBackup = (r: BackupRunRow) => ({
  id: r.id,
  created_at: r.createdAt,
  size_bytes: r.sizeBytes,
  sha256: r.sha256,
  integrity_ok: r.integrityOk === 1,
  trigger: r.trigger,
});

/** `GET /backups` and `POST /backups` (08 section 8). Download and the off-site flag come with M3.2. */
export function backupRoutes({
  authn,
  service,
  now,
}: {
  authn: Authenticator;
  service: BackupService;
  now: () => number;
}) {
  return (host: RouteHost) => {
    const { app } = host as ServerRouteHost;

    app.get('/backups', async (req) => {
      authn.authenticate(req, 'S');
      return service.list().map(toBackup);
    });

    app.post('/backups', async (req, reply) => {
      authn.authenticate(req, 'S');
      // One manual or shift-end backup per 15 minutes, for the whole instance (10 section 13).
      const last = service.lastRunAt(['manual', 'shift_end']);
      if (last !== undefined && now() - last < MIN_GAP_MS) {
        const wait = Math.ceil((MIN_GAP_MS - (now() - last)) / 1000);
        throw new ProblemError(
          'backup_rate_limited',
          'A backup was made a moment ago.',
          undefined,
          {
            'Retry-After': String(wait),
          },
        );
      }
      try {
        const row = await service.run('manual');
        return reply.status(201).send(toBackup(row!));
      } catch (e) {
        if (e instanceof BackupError && e.reason === 'disk') {
          throw new ProblemError('insufficient_storage', e.message);
        }
        if (e instanceof BackupError) {
          req.log.error({ reason: e.reason }, 'backup failed');
          throw new ProblemError(
            'internal_error',
            'The backup failed verification and was discarded.',
          );
        }
        throw e;
      }
    });
  };
}
