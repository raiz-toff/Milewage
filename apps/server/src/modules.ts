import { dirname, join } from 'node:path';
import { defineModule, type ModuleRegistry } from '@milewage/shared';
import { Authenticator } from './auth/authenticator';
import { nightlyBackupJob } from './backup/schedule';
import { fileSecrets, secretsCodec, type SecretsStore } from './backup/secrets';
import { createRestoreService } from './backup/restore';
import { createBackupService, type BackupService } from './backup/service';
import {
  createBackupRepository,
  createInstanceReader,
  createSessionRepository,
  createSettingsRepository,
} from './db';
import type { DiskMonitor } from './disk';
import { openDiagnosticsStore } from './diagnostics/store';
import { backupRoutes } from './routes/backup';
import { restoreRoutes } from './routes/restore';
import type { ServerRouteHost } from './app';
import { createServerState, type ServerState } from './state';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { diagnosticsRoutes } from './routes/diagnostics';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';
import { createShiftProcessor } from './processing/shift-processor';
import { createLive } from './routes/live';
import { createSync } from './routes/sync';
import { replayRoutes } from './routes/replay';
import { stopsRoutes } from './routes/stops';
import { trackingRoutes } from './routes/tracking';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });
export const devicesModule = defineModule({ name: 'devices', dependsOn: ['core'] });
export const trackingModule = defineModule({ name: 'tracking', dependsOn: ['core', 'devices'] });
/** Derived stops and the driver's optional labels; the runtime toggle is `settings.stops_enabled` (08 section 16.1). */
export const stopsModule = defineModule({
  name: 'stops',
  dependsOn: ['core', 'tracking'],
});
/** The route for the map and the replay scrubber (08 section 3). */
export const replayModule = defineModule({ name: 'replay', dependsOn: ['tracking'] });
/** The WebSocket feed for the web map (08 section 6). */
export const liveModule = defineModule({ name: 'live', dependsOn: ['core'] });
/** The pull path for the phone (15 section 6.5): `change_log`, `overwrite_log`, `GET /sync/changes`. */
export const syncModule = defineModule({ name: 'sync', dependsOn: ['core', 'devices'] });
export const diagnosticsModule = defineModule({ name: 'diagnostics', dependsOn: ['core'] });
/** The backup engine is never toggled off: the server holds the only copy of the data (10 section 3.1). */
export const backupModule = defineModule({
  name: 'backup',
  dependsOn: ['core'],
  toggleable: false,
});

export const serverModules = [
  coreModule,
  devicesModule,
  trackingModule,
  stopsModule,
  replayModule,
  liveModule,
  syncModule,
  diagnosticsModule,
  backupModule,
] as const;

export interface ServerContext extends CoreContext {
  /** Path of diagnostics.db (16 section 7.1); `:memory:` when omitted. Opened only if the module is on. */
  diagnosticsPath?: string;
  onDiagnosticsRecreated?: (movedTo: string, reason: string) => void;
  /** The `backups` volume (`MILEWAGE_BACKUP_DIR`). Nothing is written there until a backup runs. */
  backupDir?: string;
  /** The `config` volume (`MILEWAGE_CONFIG_DIR`), where `secrets.json` lives. */
  configDir?: string;
  /** Use this secrets store instead of `<configDir>/secrets.json`. */
  secrets?: SecretsStore;
  /** Start the nightly 03:30 job (off in tests). */
  backupSchedule?: boolean;
  /** Use this service instead of building one, so setup, migration and restore share it. */
  backup?: BackupService;
  /** Free-space rules (10 section 11.3); omitted means plenty of room. */
  disk?: DiskMonitor;
  /** Server mode shared with `buildApp`; a restore in progress answers 503 to everything else. */
  state?: ServerState;
  /** Test seam passed to the restore service (forces a revert). */
  restoreVerify?: (db: ServerContext['db']) => void;
  /** Ping interval of `GET /live`; 30 s unless a test shortens it. */
  livePingMs?: number;
  log?: (message: string, fields?: object) => void;
}

/** Builds the backup service for a connection; the time zone is the owner's, UTC before setup. */
export function buildBackupService(
  ctx: Pick<ServerContext, 'db' | 'now' | 'backupDir' | 'configDir' | 'secrets' | 'disk'>,
) {
  const settings = createSettingsRepository(ctx.db);
  const owner = createBackupRepository(ctx.db);
  const instance = createInstanceReader(ctx.db);
  return createBackupService({
    db: ctx.db,
    dir: ctx.backupDir ?? 'backups',
    now: ctx.now,
    disk: ctx.disk,
    codec: secretsCodec(ctx.secrets ?? fileSecrets(ctx.configDir ?? 'config')),
    // Scheduled backups wait for the recovery key to be confirmed (08 section 2.3).
    ready: () => instance()?.setupConfirmedAt != null,
    timeZone: () => {
      const id = owner.ownerId();
      return (id === undefined ? undefined : settings.get(id)?.timezone) ?? 'UTC';
    },
  });
}

export function createServerModules(ctx: ServerContext) {
  const authn = new Authenticator(createSessionRepository(ctx.db), ctx.now);
  const secrets = ctx.secrets ?? fileSecrets(ctx.configDir ?? 'config');
  const countries = ctx.countries ?? DEFAULT_COUNTRIES;
  const readSettings = (host: { registry: Parameters<typeof settingsReader>[0]['registry'] }) =>
    settingsReader({ ...ctx, registry: host.registry, countries });
  let store: ReturnType<typeof openDiagnosticsStore> | undefined;
  const diagnosticsStore = () =>
    (store ??= openDiagnosticsStore(
      ctx.diagnosticsPath ?? ':memory:',
      ctx.now,
      ctx.onDiagnosticsRecreated,
    ));
  const backup = ctx.backup ?? buildBackupService({ ...ctx, secrets });
  const restore = createRestoreService({
    db: ctx.db,
    backup,
    secrets,
    state: ctx.state ?? createServerState(),
    verify: ctx.restoreVerify,
    log: ctx.log,
  });
  const live = createLive({
    db: ctx.db,
    now: ctx.now,
    authn,
    pingMs: ctx.livePingMs,
    stopsOn: () => registry?.isEnabled('stops') ?? false,
  });
  const sync = createSync({ db: ctx.db, now: ctx.now, authn, readSettings });
  const uploadDir = join(dirname(ctx.db.name), '.restore-upload');
  // The registry exists only once routes are registered; the processor asks it per call.
  let registry: ModuleRegistry | undefined;
  const processor = createShiftProcessor({
    db: ctx.db,
    now: ctx.now,
    stopsOn: () => registry?.isEnabled('stops') ?? false,
  });
  return [
    defineModule({
      ...coreModule,
      routes: (host) => {
        registry = (host as ServerRouteHost).registry;
        coreRoutes(
          {
            ...ctx,
            secrets,
            processor,
            status: {
              state: ctx.state,
              disk: ctx.disk,
              lastBackup: () => backup.list()[0],
              diagnostics: (userId) => ({
                level: createSettingsRepository(ctx.db).get(userId)?.diagnosticsLevel ?? 'basic',
                db_bytes: diagnosticsStore().bytes(),
                event_count: diagnosticsStore().count(),
              }),
            },
          },
          authn,
        )(host);
      },
    }),
    defineModule({ ...devicesModule, routes: devicesRoutes({ ...ctx, authn, readSettings }) }),
    defineModule({ ...trackingModule, routes: trackingRoutes({ ...ctx, authn }) }),
    defineModule({ ...stopsModule, routes: stopsRoutes({ ...ctx, authn, processor }) }),
    defineModule({ ...replayModule, routes: replayRoutes({ ...ctx, authn }) }),
    defineModule({
      ...syncModule,
      routes: sync.routes,
      subscriptions: sync.subscriptions,
      jobs: sync.jobs,
    }),
    defineModule({
      ...liveModule,
      routes: live.routes,
      subscriptions: live.subscriptions,
      jobs: live.jobs,
    }),
    defineModule({
      ...diagnosticsModule,
      routes: diagnosticsRoutes({
        ...ctx,
        authn,
        store: diagnosticsStore,
        disk: ctx.disk && (() => ctx.disk!.state()),
      }),
      jobs: [{ name: 'diagnostics-store', start: () => () => store?.close() }],
    }),
    defineModule({
      ...backupModule,
      routes: (host) => {
        backupRoutes({ ...ctx, authn, service: backup })(host);
        restoreRoutes({ ...ctx, restore, uploadDir })(host);
      },
      jobs: ctx.backupSchedule ? [nightlyBackupJob(backup, ctx.now, ctx.log)] : [],
    }),
  ] as const;
}
