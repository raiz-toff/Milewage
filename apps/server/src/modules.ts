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
  createShiftRepository,
} from './db';
import type { DiskMonitor } from './disk';
import { createDiagnosticsKeeper } from './diagnostics/keeper';
import { captureModuleParts } from './routes/capture';
import { createCaptureStore, stateOf } from './diagnostics/capture';
import { createServerMetrics } from './diagnostics/metrics';
import { createServerRecorder, effectiveLevel } from './diagnostics/recorder';
import { statSync } from 'node:fs';
import { openDiagnosticsStore } from './diagnostics/store';
import { backupRoutes } from './routes/backup';
import { restoreRoutes } from './routes/restore';
import type { ServerRouteHost } from './app';
import type { EventEmit } from './events';
import { SERVER_VERSION } from './version';
import { createServerState, type ServerState } from './state';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { diagnosticsRoutes } from './routes/diagnostics';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';
import { createShiftProcessor } from './processing/shift-processor';
import { createLateRecompute } from './processing/late-recompute';
import { createArchiver } from './processing/archive';
import { csvExporter } from './exporters/csv';
import { geojsonExporter, gpxExporter } from './exporters/geo';
import { expensesExporter, taxSummaryExporter } from './exporters/reports';
import { taxReport } from './tax-report';
import { createExporterRegistry, type ExporterRegistry } from './exporters/registry';
import { availableFormats, exportsRoutes } from './routes/exports';
import { createSync } from './routes/sync';
import { replayRoutes } from './routes/replay';
import { createEarningsPolicy, earningsRoutes } from './routes/earnings';
import { receiptsRoutes } from './routes/receipts';
import { analyticsRoutes } from './routes/analytics';
import { goalsRoutes } from './routes/goals';
import { notificationsRoutes } from './routes/notifications';
import { progressRoutes } from './routes/progress';
import { scheduleRoutes } from './routes/schedule';
import { notify } from './notifications';
import { localDate } from './time';
import { importsRoutes } from './routes/imports';
import { maintenanceRoutes } from './routes/maintenance';
import { taxRoutes } from './routes/tax';
import { COMMA_DEFAULTS } from './comma-options';
import { receiptsDirOf } from './receipts/store';
import { expensesRoutes } from './routes/expenses';
import { platformsRoutes, platformKnown } from './routes/platforms';
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
/** The pull path for the phone (15 section 6.5): `change_log`, `overwrite_log`, `GET /sync/changes`. */
export const syncModule = defineModule({ name: 'sync', dependsOn: ['core', 'devices'] });
/** `GET /exports/{format}`; each format is a registered exporter (08 sections 11 and 16.3). */
export const exportersModule = defineModule({ name: 'exporters', dependsOn: ['core'] });
export const diagnosticsModule = defineModule({ name: 'diagnostics', dependsOn: ['core'] });
/** Time-boxed dense recording, annotations and anonymized replay; off by default (16 section 8). */
export const captureModule = defineModule({
  name: 'capture',
  dependsOn: ['diagnostics', 'tracking', 'devices'],
  defaultEnabled: false,
});
/** The driver's platforms: built-ins plus their own, with overrides (18 section 4.2). */
export const platformsModule = defineModule({ name: 'platforms', dependsOn: ['core'] });
/** The driver's typed payout per shift and platform (18 section 4.3). */
export const earningsModule = defineModule({ name: 'earnings', dependsOn: ['core'] });
/** Expenses, categories and recurring reminders (18 section 5). */
export const expensesModule = defineModule({ name: 'expenses', dependsOn: ['core'] });
/** One receipt photo or PDF per expense, kept on the volume and in every backup (18 section 5.4). */
export const receiptsModule = defineModule({ name: 'receipts', dependsOn: ['expenses'] });
/** Income, hours, shifts or active-distance goals with progress at read time (18 section 8.1). */
export const goalsModule = defineModule({ name: 'goals', dependsOn: ['core'] });
/** Period groups over shifts, earnings and expenses; owns no table (18 section 10.1). */
export const analyticsModule = defineModule({ name: 'analytics', dependsOn: ['core'] });
/** Per-vehicle service record; a cost becomes a linked expense (18 section 6). */
export const maintenanceModule = defineModule({ name: 'maintenance', dependsOn: ['core'] });
/** Generic CSV import of the driver's own expenses and shifts, in two steps (18 section 12). */
export const importModule = defineModule({ name: 'import', dependsOn: ['core'] });
/** The in-app inbox and its toggles; the phone fires its own local reminders (18 section 11). */
export const notificationsModule = defineModule({ name: 'notifications', dependsOn: ['core'] });
/** Planned shifts, repeating templates and off days; **off by default** (18 section 9, 16 item 1). */
export const scheduleModule = defineModule({
  name: 'schedule',
  dependsOn: ['core'],
  defaultEnabled: false,
});
/** XP, level, streak, weekly challenges and 24 badges, derived from what is already recorded; **off by default** (18 section 8.2). */
export const progressModule = defineModule({
  name: 'progress',
  dependsOn: ['goals', 'earnings'],
  defaultEnabled: false,
});
/** The Tax Center: an estimate, never a filing (18 section 7). CA only until other packs are verified. */
export const taxModule = defineModule({ name: 'tax', dependsOn: ['core'] });
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
  syncModule,
  exportersModule,
  diagnosticsModule,
  captureModule,
  platformsModule,
  earningsModule,
  expensesModule,
  receiptsModule,
  taxModule,
  goalsModule,
  analyticsModule,
  maintenanceModule,
  importModule,
  notificationsModule,
  scheduleModule,
  progressModule,
  backupModule,
] as const;

export interface ServerContext extends CoreContext {
  /** Path of diagnostics.db (16 section 7.1); `:memory:` when omitted. Opened only if the module is on. */
  diagnosticsPath?: string;
  onDiagnosticsRecreated?: (movedTo: string, reason: string) => void;
  /** Size cap of the diagnostics events (100 MB unless a test lowers it). */
  diagnosticsCapBytes?: number;
  /** Interval of the 30 day capture purge (a day unless a test shortens it). */
  captureHousekeepingMs?: number;
  /** `diagnostics.bundle` (default on). */
  diagnosticsBundle?: boolean;
  /** Interval of `server.sample` and `api.window` (15 minutes unless a test shortens it). */
  diagnosticsSampleMs?: number;
  /** Interval of the retention job (a day unless a test shortens it). */
  diagnosticsHousekeepingMs?: number;
  /** The `backups` volume (`MILEWAGE_BACKUP_DIR`). Nothing is written there until a backup runs. */
  backupDir?: string;
  /** The `config` volume (`MILEWAGE_CONFIG_DIR`), where `secrets.json` lives. */
  configDir?: string;
  /** Use this secrets store instead of `<configDir>/secrets.json`. */
  secrets?: SecretsStore;
  /** The Android app file `GET /app/android.apk` serves when it exists (plan 24 Q2). */
  apkPath?: string;
  /** Start the nightly 03:30 job (off in tests). */
  backupSchedule?: boolean;
  /** Exporters; defaults to csv, gpx and geojson. A new format registers here without other edits. */
  exporters?: ExporterRegistry;
  /** Formats switched on (`modules.export_<format>`); default all registered. */
  enabledExportFormats?: () => readonly string[];
  /** `backup.on_shift_end` (default on): a verified backup after a shift ends, at most one per 15 minutes. */
  backupOnShiftEnd?: boolean;
  /** Use this service instead of building one, so setup, migration and restore share it. */
  backup?: BackupService;
  /** Free-space rules (10 section 11.3); omitted means plenty of room. */
  disk?: DiskMonitor;
  /** Server mode shared with `buildApp`; a restore in progress answers 503 to everything else. */
  state?: ServerState;
  /** Test seam passed to the restore service (forces a revert). */
  restoreVerify?: (db: ServerContext['db']) => void;
  /** Interval of the raw-point retention job (a day unless a test shortens it). */
  archiveEveryMs?: number;
  /** Debounce of the recompute after late points (5 s unless a test shortens it). */
  lateRecomputeMs?: number;
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
    receiptsDir: receiptsDirOf(ctx.db),
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
  const captureFor = (_userId: number, deviceId: number) => {
    if (!registry?.isEnabled('capture')) return null;
    const c = createCaptureStore(diagnosticsStore().db);
    const id = c.activeFor(deviceId, ctx.now())[0];
    const s = id === undefined ? undefined : c.session(id);
    return s && stateOf(s, ctx.now()) === 'active'
      ? {
          id: s.id,
          profile: s.profile,
          expires_at: s.expiresAt,
          max_shifts: s.maxShifts,
          shifts_done: c.shiftsDone(s.id),
        }
      : null;
  };
  const readSettings = (host: { registry: Parameters<typeof settingsReader>[0]['registry'] }) =>
    settingsReader({
      ...ctx,
      registry: host.registry,
      countries,
      backupDownload: ctx.backupDownload !== false,
      exportFormats,
      captureFor,
    });
  let store: ReturnType<typeof openDiagnosticsStore> | undefined;
  const diagnosticsStore = () =>
    (store ??= openDiagnosticsStore(
      ctx.diagnosticsPath ?? ':memory:',
      ctx.now,
      ctx.onDiagnosticsRecreated,
    ));
  const keeper = createDiagnosticsKeeper({
    store: diagnosticsStore,
    now: ctx.now,
    disk: ctx.disk && (() => ctx.disk!.state()),
    owner: () => createBackupRepository(ctx.db).ownerId(),
    version: SERVER_VERSION,
    capBytes: ctx.diagnosticsCapBytes,
    everyMs: ctx.diagnosticsHousekeepingMs,
    log: ctx.log,
  });
  const backup = ctx.backup ?? buildBackupService({ ...ctx, secrets });
  const diagFile = ctx.diagnosticsPath ?? ':memory:';
  backup.onFinished((r) => busEmit?.('backup.finished', r));
  const recorder = createServerRecorder({
    store: diagnosticsStore,
    now: ctx.now,
    owner: () => createBackupRepository(ctx.db).ownerId(),
    level: (userId) => effectiveLevel(createSettingsRepository(ctx.db).get(userId), ctx.now()),
    disk: ctx.disk && (() => ctx.disk!.state()),
    version: SERVER_VERSION,
    shiftClientId: (id) => createShiftRepository(ctx.db).byId(id)?.clientId,
    drop: (reason) => keeper.drop(reason),
  });
  const restore = createRestoreService({
    db: ctx.db,
    backup,
    secrets,
    state: ctx.state ?? createServerState(),
    verify: ctx.restoreVerify,
    receiptsDir: receiptsDirOf(ctx.db),
    log: ctx.log,
  });
  const metrics = createServerMetrics({
    recorder,
    now: ctx.now,
    disk: ctx.disk,
    everyMs: ctx.diagnosticsSampleMs,
    paths: () => ({
      db: ctx.db.name,
      diag: diagFile,
      bytes: (f) => {
        try {
          return statSync(f).size;
        } catch {
          return 0;
        }
      },
    }),
    modules: () =>
      Object.fromEntries(
        [
          'devices',
          'tracking',
          'stops',
          'replay',
          'sync',
          'exporters',
          'diagnostics',
          'capture',
        ].map((m) => [m, registry?.isEnabled(m) ?? false]),
      ),
    schemaVersion: () =>
      String(ctx.db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()),
    sqliteVersion: () => String(ctx.db.prepare('SELECT sqlite_version()').pluck().get()),
    markerPath: diagFile === ':memory:' ? undefined : `${diagFile}.running`,
  });
  const capture = captureModuleParts({
    db: ctx.db,
    now: ctx.now,
    authn,
    store: diagnosticsStore,
    disk: ctx.disk && (() => ctx.disk!.state()),
    purgeEveryMs: ctx.captureHousekeepingMs,
    announce: (event, session, shiftsDone) =>
      busEmit?.('capture.state', { event, profile: session.profile, shiftsDone }),
  });
  const sync = createSync({ db: ctx.db, now: ctx.now, authn, readSettings });
  const exporters =
    ctx.exporters ??
    createExporterRegistry([
      csvExporter,
      gpxExporter,
      geojsonExporter,
      expensesExporter,
      taxSummaryExporter,
    ]);
  const exportFormats = (reg: ModuleRegistry) =>
    reg.isEnabled('exporters')
      ? availableFormats(exporters, (m) => reg.isEnabled(m), ctx.enabledExportFormats)
      : [];
  const earningsPolicy = (reg: ModuleRegistry) =>
    createEarningsPolicy(ctx.db, reg, ctx.comma?.earningsOverride);
  const uploadDir = join(dirname(ctx.db.name), '.restore-upload');
  // The registry exists only once routes are registered; the processor asks it per call.
  let registry: ModuleRegistry | undefined;
  let busEmit: EventEmit | undefined;
  const processor = createShiftProcessor({
    db: ctx.db,
    now: ctx.now,
    stopsOn: () => registry?.isEnabled('stops') ?? false,
    emit: () => busEmit,
  });
  const late = createLateRecompute({
    db: ctx.db,
    processor,
    emit: () => busEmit,
    stopsOn: () => registry?.isEnabled('stops') ?? false,
    delayMs: ctx.lateRecomputeMs,
    log: ctx.log,
  });
  const archiver = createArchiver({
    db: ctx.db,
    now: ctx.now,
    emit: () => busEmit,
    everyMs: ctx.archiveEveryMs,
    log: ctx.log,
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
            exportFormats,
            captureFor,
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
    defineModule({
      ...trackingModule,
      routes: (host) => {
        busEmit = (host as ServerRouteHost).bus.emit;
        trackingRoutes({ ...ctx, authn, processor })(host);
      },
      subscriptions: late.subscriptions,
      jobs: [late.job, archiver.job],
    }),
    defineModule({
      ...stopsModule,
      routes: stopsRoutes({
        ...ctx,
        authn,
        processor,
        platformOk: (userId, slug) =>
          !registry?.isEnabled('platforms') || platformKnown(ctx.db, userId, slug),
      }),
    }),
    defineModule({ ...platformsModule, routes: platformsRoutes({ ...ctx, authn }) }),
    defineModule({ ...expensesModule, routes: expensesRoutes({ ...ctx, authn }) }),
    defineModule({
      ...goalsModule,
      routes: goalsRoutes({ ...ctx, authn, override: ctx.comma?.earningsOverride }),
    }),
    defineModule({
      ...analyticsModule,
      routes: analyticsRoutes({ ...ctx, authn, override: ctx.comma?.earningsOverride }),
    }),
    defineModule({ ...maintenanceModule, routes: maintenanceRoutes({ ...ctx, authn }) }),
    defineModule({
      ...notificationsModule,
      routes: notificationsRoutes({
        ...ctx,
        authn,
        taxCountries: ctx.comma?.taxCountries ?? COMMA_DEFAULTS.taxCountries,
        override: ctx.comma?.earningsOverride,
      }),
      subscriptions: {
        // A failed backup is an event, not a state that can be re-read later, so it is recorded when it happens.
        'backup.finished'(r) {
          if (r.ok) return;
          const owner = createBackupRepository(ctx.db).ownerId();
          const tz =
            owner === undefined ? undefined : createSettingsRepository(ctx.db).get(owner)?.timezone;
          if (owner !== undefined && tz) {
            notify(
              { db: ctx.db, now: ctx.now, emit: () => busEmit },
              owner,
              'backup_failed',
              `backup_failed:${localDate(ctx.now(), tz)}`,
              'backup_failed',
            );
          }
        },
      },
    }),
    defineModule({
      ...progressModule,
      routes: progressRoutes({
        ...ctx,
        authn,
        override: ctx.comma?.earningsOverride,
        challengeTargetCents:
          ctx.comma?.challengeTargetCents ?? COMMA_DEFAULTS.challengeTargetCents,
      }),
    }),
    defineModule({ ...scheduleModule, routes: scheduleRoutes({ ...ctx, authn }) }),
    defineModule({ ...importModule, routes: importsRoutes({ ...ctx, authn }) }),
    defineModule({ ...receiptsModule, routes: receiptsRoutes({ ...ctx, authn }) }),
    defineModule({
      ...taxModule,
      routes: taxRoutes({
        ...ctx,
        authn,
        countries: ctx.comma?.taxCountries ?? COMMA_DEFAULTS.taxCountries,
        override: ctx.comma?.earningsOverride,
      }),
    }),
    defineModule({
      ...earningsModule,
      routes: earningsRoutes({ ...ctx, authn, policy: earningsPolicy }),
    }),
    defineModule({ ...replayModule, routes: replayRoutes({ ...ctx, authn }) }),
    defineModule({
      ...syncModule,
      routes: sync.routes,
      subscriptions: sync.subscriptions,
      jobs: sync.jobs,
    }),
    defineModule({
      ...exportersModule,
      routes: exportsRoutes({
        ...ctx,
        authn,
        exporters,
        formats: ctx.enabledExportFormats,
        earnings: earningsPolicy,
        taxReport: (reg, userId, year) =>
          taxReport(
            {
              db: ctx.db,
              registry: reg,
              countries: ctx.comma?.taxCountries ?? COMMA_DEFAULTS.taxCountries,
              override: ctx.comma?.earningsOverride,
            },
            userId,
            year,
          ),
      }),
    }),
    defineModule({
      ...diagnosticsModule,
      routes: diagnosticsRoutes({
        ...ctx,
        authn,
        store: diagnosticsStore,
        disk: ctx.disk && (() => ctx.disk!.state()),
        onDrop: (reason) => keeper.drop(reason),
        observe: metrics.install,
        bundle: ctx.diagnosticsBundle !== false,
        lastBackupAt: () => backup.list().find((r) => r.integrityOk === 1)?.createdAt,
      }),
      subscriptions: { ...recorder.subscriptions, ...metrics.subscriptions },
      jobs: [
        { name: 'diagnostics-store', start: () => () => store?.close() },
        keeper.job(),
        metrics.job,
      ],
    }),
    defineModule({
      ...captureModule,
      routes: capture.routes,
      jobs: [capture.job],
    }),
    defineModule({
      ...backupModule,
      routes: (host) => {
        backupRoutes({ ...ctx, authn, service: backup, download: ctx.backupDownload })(host);
        restoreRoutes({ ...ctx, restore, uploadDir })(host);
      },
      jobs: ctx.backupSchedule ? [nightlyBackupJob(backup, ctx.now, ctx.log)] : [],
      subscriptions:
        ctx.backupOnShiftEnd === false
          ? {}
          : {
              'shift.ended'() {
                // One manual or shift-end backup per 15 minutes for the instance (10 section 13).
                const last = backup.lastRunAt(['manual', 'shift_end']);
                if (last !== undefined && ctx.now() - last < 15 * 60_000) return;
                backup
                  .run('shift_end')
                  .catch((e: Error) => ctx.log?.('shift-end backup failed', { error: e.message }));
              },
            },
    }),
  ] as const;
}
