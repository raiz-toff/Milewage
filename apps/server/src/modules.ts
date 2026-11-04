import { dirname, join } from 'node:path';
import { defineModule } from '@milewage/shared';
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
import { openDiagnosticsStore } from './diagnostics/store';
import { backupRoutes } from './routes/backup';
import { restoreRoutes } from './routes/restore';
import { createServerState, type ServerState } from './state';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { diagnosticsRoutes } from './routes/diagnostics';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';
import { trackingRoutes } from './routes/tracking';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });
export const devicesModule = defineModule({ name: 'devices', dependsOn: ['core'] });
export const trackingModule = defineModule({ name: 'tracking', dependsOn: ['core', 'devices'] });
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
  /** Server mode shared with `buildApp`; a restore in progress answers 503 to everything else. */
  state?: ServerState;
  /** Test seam passed to the restore service (forces a revert). */
  restoreVerify?: (db: ServerContext['db']) => void;
  log?: (message: string, fields?: object) => void;
}

/** Builds the backup service for a connection; the time zone is the owner's, UTC before setup. */
export function buildBackupService(
  ctx: Pick<ServerContext, 'db' | 'now' | 'backupDir' | 'configDir' | 'secrets'>,
) {
  const settings = createSettingsRepository(ctx.db);
  const owner = createBackupRepository(ctx.db);
  const instance = createInstanceReader(ctx.db);
  return createBackupService({
    db: ctx.db,
    dir: ctx.backupDir ?? 'backups',
    now: ctx.now,
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
  const uploadDir = join(dirname(ctx.db.name), '.restore-upload');
  return [
    defineModule({ ...coreModule, routes: coreRoutes({ ...ctx, secrets }, authn) }),
    defineModule({ ...devicesModule, routes: devicesRoutes({ ...ctx, authn, readSettings }) }),
    defineModule({ ...trackingModule, routes: trackingRoutes({ ...ctx, authn }) }),
    defineModule({
      ...diagnosticsModule,
      routes: diagnosticsRoutes({ ...ctx, authn, store: diagnosticsStore }),
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
