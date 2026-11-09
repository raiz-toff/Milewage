import multipart from '@fastify/multipart';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import type { ServerRouteHost } from '../app';
import { FailureLimiter } from '../auth/limiter';
import type { RestoreService } from '../backup/restore';
import { ProblemError } from '../errors';

const MAX_UPLOAD = 512 * 1024 * 1024;

/**
 * `POST /setup/restore` (08 section 2.3): multipart `file` (the `.db.gz.age`) and `recovery_key`.
 * Public, but refused with 409 once any user exists. The key is read into memory for this request,
 * never logged and never stored. The upload is streamed to disk, never buffered.
 */
export function restoreRoutes({
  restore,
  uploadDir,
  now,
}: {
  restore: RestoreService;
  uploadDir: string;
  now: () => number;
}) {
  return ({ app }: ServerRouteHost) => {
    // Wrong keys are the only thing worth guessing at here: 5 failures per 15 minutes per client.
    const failures = new FailureLimiter(5, 15 * 60 * 1000, now);
    void app.register(multipart, {
      limits: { fileSize: MAX_UPLOAD, files: 1, fields: 2, fieldSize: 1024, parts: 3 },
    });

    app.post('/setup/restore', { bodyLimit: MAX_UPLOAD + 1024 * 1024 }, async (req) => {
      const wait = failures.retryAfter(req.ip);
      if (wait > 0) {
        const headers = { 'Retry-After': String(wait) };
        throw new ProblemError('rate_limited', 'Too many failed restores.', undefined, headers);
      }
      if (!req.isMultipart()) {
        throw new ProblemError('unsupported_media_type', 'Send multipart/form-data.');
      }
      mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
      const upload = join(uploadDir, `upload-${randomBytes(8).toString('hex')}.age`);
      let recoveryKey: string | undefined;
      let haveFile = false;
      try {
        for await (const part of req.parts()) {
          if (part.type === 'file' && part.fieldname === 'file') {
            await pipeline(part.file, createWriteStream(upload, { mode: 0o600 }));
            if (part.file.truncated) throw new ProblemError('payload_too_large');
            haveFile = true;
          } else if (part.type === 'field' && part.fieldname === 'recovery_key') {
            recoveryKey = String(part.value);
          } else if (part.type === 'file') {
            part.file.resume();
          }
        }
        if (!haveFile || !recoveryKey) {
          throw new ProblemError(
            'validation_failed',
            'Send the backup file and the recovery key.',
            [
              ...(haveFile ? [] : [{ path: '/file', message: 'is required' }]),
              ...(recoveryKey ? [] : [{ path: '/recovery_key', message: 'is required' }]),
            ],
          );
        }
        try {
          const result = await restore.restore(upload, recoveryKey, false);
          failures.reset(req.ip);
          return result;
        } catch (e) {
          if (e instanceof ProblemError && e.status === 422) failures.fail(req.ip);
          throw e;
        }
      } finally {
        rmSync(upload, { force: true });
      }
    });
  };
}
