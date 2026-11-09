import { createReadStream, statSync } from 'node:fs';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { FailureLimiter } from '../auth/limiter';
import { verifyPassword } from '../auth/password';
import { createSettingsRepository, createUserRepository, type BackupRunRow, type Db } from '../db';
import { generateRecoveryKey, keyTail, tailCheck } from '../backup/age';
import { BackupError } from '../backup/engine';
import { fileSecrets, type SecretsStore } from '../backup/secrets';
import type { BackupService } from '../backup/service';
import { ProblemError } from '../errors';
import { offsiteState } from './status';
import { str, strictObject } from './util';

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
  secrets = fileSecrets('config'),
  download = true,
}: {
  db: Db;
  authn: Authenticator;
  service: BackupService;
  now: () => number;
  /** `config/secrets.json`: the public key new backups are encrypted to. */
  secrets?: SecretsStore;
  /** `backup.download`: the download route and the off-site acknowledgement (10 section 3.1). */
  download?: boolean;
}) {
  return ({ app }: ServerRouteHost) => {
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

    recoveryKeyRoutes(app, { db, authn, service, now, secrets });

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

/**
 * A new recovery key after the old one is lost or may have leaked (10 section 9 "Rotation"). Like
 * setup it takes two steps: `POST /backups/recovery-key` (the owner's password again) makes a key
 * pair and shows the private key once; `POST /backups/recovery-key/confirm` with its last 6
 * characters switches backups to it and makes one backup with it straight away. Until then every
 * backup still uses the old key. Old backups are not re-encrypted: they need the old key forever.
 * The waiting key lives in memory only, so a restart drops it and the driver starts again.
 */
function recoveryKeyRoutes(
  app: ServerRouteHost['app'],
  {
    db,
    authn,
    service,
    now,
    secrets,
  }: {
    db: Db;
    authn: Authenticator;
    service: BackupService;
    now: () => number;
    secrets: SecretsStore;
  },
) {
  const users = createUserRepository(db);
  // A stolen session must not be able to guess the password here: 5 wrong ones per 15 minutes.
  const failures = new FailureLimiter(5, 15 * 60 * 1000, now);
  let waiting: { userId: number; recipient: string; tailCheck: string } | undefined;

  app.post(
    '/backups/recovery-key',
    { schema: { body: strictObject({ password: str(1) }, ['password']) } },
    async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const key = `user:${userId}`;
      const wait = failures.retryAfter(key);
      if (wait > 0) {
        const headers = { 'Retry-After': String(wait) };
        throw new ProblemError('rate_limited', 'Too many wrong passwords.', undefined, headers);
      }
      const user = users.findById(userId);
      const password = (req.body as { password: string }).password;
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        failures.fail(key);
        throw new ProblemError('invalid_credentials', 'The password is wrong.');
      }
      failures.reset(key);
      const made = await generateRecoveryKey();
      // Only the public half and a hash of the tail are kept, and only until it is confirmed.
      waiting = { userId, recipient: made.recipient, tailCheck: tailCheck(keyTail(made.identity)) };
      return reply
        .status(201)
        .send({ recovery_key: made.identity, state: 'needs_confirmation' as const });
    },
  );

  app.post(
    '/backups/recovery-key/confirm',
    { schema: { body: strictObject({ last6: str(6, 6) }, ['last6']) } },
    async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const last6 = (req.body as { last6: string }).last6;
      if (!waiting || waiting.userId !== userId) {
        throw new ProblemError(
          'validation_failed',
          'No new recovery key is waiting. Make a new one first.',
        );
      }
      if (tailCheck(last6) !== waiting.tailCheck) {
        throw new ProblemError('validation_failed', 'That is not the end of the new key.', [
          { path: '/last6', message: 'does not match the last 6 characters of the new key' },
        ]);
      }
      secrets.write({ age_public_key: waiting.recipient });
      waiting = undefined;
      req.log.info('recovery key replaced; older backups still need the old key');
      // One backup under the new key now, so the driver does not wait for the night.
      try {
        const row = await service.runAfterCurrent('manual');
        return { state: 'ready' as const, backup: row ? toBackup(row) : null };
      } catch (e) {
        req.log.error({ reason: (e as BackupError).reason }, 'backup with the new key failed');
        return { state: 'ready' as const, backup: null };
      }
    },
  );
}
