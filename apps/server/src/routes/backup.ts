import { createReadStream, statSync } from 'node:fs';
import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createSettingsRepository, type BackupRunRow, type Db } from '../db';
import { BackupError } from '../backup/engine';
import type { BackupService } from '../backup/service';
import { ProblemError } from '../errors';
import { offsiteState } from './status';
import { strictObject } from './util';

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
  db,
  authn,
  service,
  now,
  download = true,
}: {
  db: Db;
  authn: Authenticator;
  service: BackupService;
  now: () => number;
  /** `backup.download`: the download route and the off-site acknowledgement (10 section 3.1). */
  download?: boolean;
}) {
  return (host: RouteHost) => {
    const { app } = host as ServerRouteHost;

    app.get('/backups', async (req) => {
      authn.authenticate(req, 'S');
      return service.list().map(toBackup);
    });

    const settings = createSettingsRepository(db);
    if (download) {
      app.get(
        '/backups/:id/download',
        { schema: { params: strictObject({ id: { type: 'integer', minimum: 1 } }, ['id']) } },
        async (req, reply) => {
          const { userId } = authn.authenticate(req, 'S');
          const row = service.byId((req.params as { id: number }).id);
          const path = row && row.integrityOk === 1 ? service.pathOf(row) : undefined;
          let size = 0;
          try {
            size = path ? statSync(path).size : 0;
          } catch {
            size = 0;
          }
          if (!row || !path || size === 0) throw new ProblemError('not_found', 'No such backup.');
          // The reminder resets when the file is handed out, not when it is verified to arrive (10 section 6).
          settings.update(userId, { offsiteLastDownloadAt: now() });
          const name = row.fileName.split('/').pop() ?? 'milewage-backup.db.gz.age';
          return reply
            .header('Content-Type', 'application/octet-stream')
            .header('Content-Length', size)
            .header('Content-Disposition', `attachment; filename="${name}"`)
            .send(createReadStream(path));
        },
      );

      app.put(
        '/backups/offsite-ack',
        {
          schema: {
            body: strictObject({ synced_elsewhere: { type: 'boolean' } }, ['synced_elsewhere']),
          },
        },
        async (req) => {
          const { userId } = authn.authenticate(req, 'S');
          const synced = (req.body as { synced_elsewhere: boolean }).synced_elsewhere;
          const row = settings.update(userId, { offsiteSyncedElsewhereAt: synced ? now() : null });
          return offsiteState(row, service.list().length > 0, now());
        },
      );
    }

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
