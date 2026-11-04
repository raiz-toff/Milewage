import { statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@milewage/shared';
import { createSettingsRepository, type BackupRunRow, type Db } from '../db';
import type { DiskMonitor } from '../disk';
import { createServerState, type ServerState } from '../state';
import { SERVER_VERSION } from '../version';
import { toBackup } from './backup';
import type { AuthFn } from './util';

const DAY = 24 * 60 * 60 * 1000;
const size = (path: string) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export interface StatusContext {
  db: Db;
  now: () => number;
  auth: AuthFn;
  registry: ModuleRegistry;
  state?: ServerState;
  disk?: DiskMonitor;
  /** The newest backup_runs row, if any. */
  lastBackup?: () => BackupRunRow | undefined;
  /** `diagnostics` block of SystemStatus; only called when the diagnostics module is on. */
  diagnostics?: (userId: number) => { level: string; db_bytes: number; event_count: number };
}

/** `GET /system/status` (08 section 11, 10 section 11.1): web session only. */
export function statusRoute(app: FastifyInstance, ctx: StatusContext) {
  const settings = createSettingsRepository(ctx.db);
  const state = ctx.state ?? createServerState();
  const count = (sql: string) => ctx.db.prepare(sql).pluck().get() as number;

  app.get('/system/status', async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const t = ctx.now();
    const disk = ctx.disk?.snapshot();
    const last = ctx.lastBackup?.();
    const row = settings.get(userId);
    // 10 section 6: remind until a backup was downloaded in the last 30 days or the driver said a
    // synced folder exists (asked again every 90 days). Nothing to remind about before the first backup.
    const downloaded = (row?.offsiteLastDownloadAt ?? 0) > t - 30 * DAY;
    const synced = (row?.offsiteSyncedElsewhereAt ?? 0) > t - 90 * DAY;
    return {
      app_version: SERVER_VERSION,
      schema_version: count('SELECT count(*) FROM schema_migrations'),
      sqlite_version: ctx.db.prepare('SELECT sqlite_version()').pluck().get() as string,
      db_bytes: size(ctx.db.name),
      wal_bytes: size(`${ctx.db.name}-wal`),
      disk_free_bytes: disk?.freeBytes ?? 0,
      disk_state: disk?.state ?? 'ok',
      last_backup: last ? toBackup(last) : null,
      offsite: {
        last_download_at: row?.offsiteLastDownloadAt ?? null,
        synced_elsewhere_at: row?.offsiteSyncedElsewhereAt ?? null,
        reminder_due: last !== undefined && !downloaded && !synced,
      },
      paired_device_count: count('SELECT count(*) FROM devices WHERE revoked_at IS NULL'),
      mode: state.mode,
      ...(ctx.registry.isEnabled('diagnostics') && ctx.diagnostics
        ? { diagnostics: ctx.diagnostics(userId) }
        : {}),
    };
  });
}
