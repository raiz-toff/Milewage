import type { FastifyInstance } from 'fastify';
import type { Db } from '../db';
import type { DiskMonitor } from '../disk';
import type { UpdateService } from '../updates';
import { SERVER_VERSION } from '../version';
import { strictObject, type AuthFn } from './util';

const HOUR = 60 * 60 * 1000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const HEALTH_LIMITS = {
  backupWarnAfterMs: 36 * HOUR,
  diskWarnBelow: 2 * GB,
  diskFailBelow: 500 * MB,
  clockWarnOverMs: 2 * 60_000,
} as const;

export interface HealthCheck {
  id: 'database' | 'backup' | 'disk' | 'clock' | 'version' | 'updates';
  status: 'ok' | 'warn' | 'fail';
  title: string;
  detail: string;
  /** What to do about it; null when nothing is wrong. */
  fix: string | null;
}

export interface HealthInputs {
  now: number;
  /** Result lines of `PRAGMA quick_check`; `['ok']` is a healthy file. */
  integrity: string[];
  /** Creation time of the newest backup that passed its own check, if any. */
  newestBackupAt: number | undefined;
  /** Backups exist but none passed their check. */
  backupsFailedCheck: boolean;
  /** Free bytes of the data volume; absent when the server does not measure it. */
  diskFreeBytes: number | undefined;
  /** The browser's own clock; absent when the request did not carry it. */
  clientTime: number | undefined;
  updatesEnabled: boolean;
  updateError: string | null;
  updateCheckedAt: number | null;
  version: string;
}

const gb = (n: number) => `${(n / GB).toFixed(1)} GB`;
const hours = (ms: number) => `${Math.floor(ms / HOUR)} hours`;

/** The checks the server can really make from inside its container. Pure: every input is passed in. */
export function healthChecks(i: HealthInputs): HealthCheck[] {
  const checks: HealthCheck[] = [];

  const intact = i.integrity.length === 1 && i.integrity[0] === 'ok';
  checks.push({
    id: 'database',
    status: intact ? 'ok' : 'fail',
    title: 'Database',
    detail: intact
      ? 'The database file passed SQLite’s quick integrity check.'
      : `SQLite reported a problem: ${(i.integrity[0] ?? 'no answer').slice(0, 160)}`,
    fix: intact
      ? null
      : 'Do not make more changes. Stop the server, then restore the newest backup (Backups page, or the restore steps in the troubleshooting help).',
  });

  if (i.newestBackupAt === undefined) {
    checks.push({
      id: 'backup',
      status: 'fail',
      title: 'Backups',
      detail: i.backupsFailedCheck
        ? 'No backup has passed its own check.'
        : 'No backup has been made yet.',
      fix: 'Open Backups and choose Back up now. Nightly backups run at 03:30 once the recovery key is confirmed.',
    });
  } else {
    const age = i.now - i.newestBackupAt;
    const old = age > HEALTH_LIMITS.backupWarnAfterMs;
    checks.push({
      id: 'backup',
      status: old ? 'warn' : 'ok',
      title: 'Backups',
      detail: `The newest good backup is ${hours(Math.max(0, age))} old.`,
      fix: old
        ? 'Nightly backups should be less than a day old. Open Backups, choose Back up now and read the last run’s result.'
        : null,
    });
  }

  if (i.diskFreeBytes !== undefined) {
    const free = i.diskFreeBytes;
    const status =
      free < HEALTH_LIMITS.diskFailBelow
        ? 'fail'
        : free < HEALTH_LIMITS.diskWarnBelow
          ? 'warn'
          : 'ok';
    checks.push({
      id: 'disk',
      status,
      title: 'Free disk space',
      detail: `${gb(free)} free on the volume that holds your data.`,
      fix:
        status === 'ok'
          ? null
          : 'Free space on the server’s disk, for example old Docker images (docker image prune) or files outside MileWage. Below 200 MB the server refuses new data.',
    });
  }

  if (i.clientTime !== undefined) {
    const skew = Math.abs(i.clientTime - i.now);
    const off = skew > HEALTH_LIMITS.clockWarnOverMs;
    checks.push({
      id: 'clock',
      status: off ? 'warn' : 'ok',
      title: 'Clock',
      detail: off
        ? `This browser’s clock and the server’s differ by ${Math.round(skew / 60_000)} minutes.`
        : 'This browser’s clock and the server’s agree.',
      fix: off
        ? 'Turn on automatic time on the server’s computer (and on this device). Shift times use the server’s clock.'
        : null,
    });
  }

  checks.push({
    id: 'version',
    status: 'ok',
    title: 'Version',
    detail: `MileWage ${i.version} is running.`,
    fix: null,
  });

  const failed = i.updatesEnabled && i.updateError !== null;
  checks.push({
    id: 'updates',
    status: failed ? 'warn' : 'ok',
    title: 'Update check',
    detail: !i.updatesEnabled
      ? 'Switched off in Settings. The server does not look for new versions.'
      : failed
        ? 'The last check for a new version did not work.'
        : i.updateCheckedAt === null
          ? 'No check has run yet. The first one runs soon after the server starts.'
          : 'The last check for a new version worked.',
    fix: failed
      ? 'The server may have no internet access, or GitHub may be down. Try Check now later; nothing else is affected.'
      : null,
  });

  return checks;
}

export interface HealthContext {
  db: Db;
  now: () => number;
  auth: AuthFn;
  disk?: DiskMonitor;
  /** Backup runs, newest first, as the backup service lists them. */
  backups: () => { createdAt: number; integrityOk: number }[];
  updates: UpdateService;
  /** The owner's switch (`settings.update_check_enabled`). */
  updatesEnabled: (userId: number) => boolean;
}

const info = (u: ReturnType<UpdateService['info']>, enabled: boolean) => ({
  enabled,
  current_version: SERVER_VERSION,
  latest_version: u.latestVersion,
  available: u.available,
  release_url: u.releaseUrl,
  notes_url: u.notesUrl,
  checked_at: u.checkedAt,
  check_failed: u.error !== null,
});

/** `GET /health/checks` and `POST /health/update-check`: web session only. */
export function healthRoutes(app: FastifyInstance, ctx: HealthContext) {
  app.get(
    '/health/checks',
    {
      schema: {
        querystring: strictObject({ client_time: { type: 'integer', minimum: 0 } }, []),
      },
    },
    async (req) => {
      const { userId } = ctx.auth(req, 'S');
      const enabled = ctx.updatesEnabled(userId);
      const runs = ctx.backups();
      const good = runs.find((r) => r.integrityOk === 1);
      const state = ctx.updates.state();
      const clientTime = (req.query as { client_time?: number }).client_time;
      const checks = healthChecks({
        now: ctx.now(),
        integrity: ctx.db.prepare('PRAGMA quick_check').pluck().all() as string[],
        newestBackupAt: good?.createdAt,
        backupsFailedCheck: runs.length > 0 && !good,
        diskFreeBytes: ctx.disk?.snapshot().freeBytes,
        clientTime,
        updatesEnabled: enabled,
        updateError: state?.error ?? null,
        updateCheckedAt: state?.succeededAt ?? null,
        version: SERVER_VERSION,
      });
      return { checks, update: info(ctx.updates.info(), enabled) };
    },
  );

  // "Check now": a deliberate request, so it runs even while the daily check is switched off.
  app.post('/health/update-check', async (req) => {
    const { userId } = ctx.auth(req, 'S');
    await ctx.updates.check();
    return info(ctx.updates.info(), ctx.updatesEnabled(userId));
  });
}
