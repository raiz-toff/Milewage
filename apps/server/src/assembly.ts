import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  buildRegistry,
  countryModules,
  createEventBus,
  resolveModuleConfig,
  type EventBus,
  type ModuleRegistry,
} from '@milewage/shared';
import { buildHttpApp } from './app';
import { Authenticator } from './auth/authenticator';
import { fileSecrets, secretsCodec, type SecretsStore } from './backup/secrets';
import { createBackupService, type BackupService } from './backup/service';
import { exportFormatsOn, type ServerConfig } from './config';
import { createInstanceReader, createSessionRepository, type Db } from './db';
import type { DiskMonitor } from './disk';
import { createDriverContexts, type DriverContexts } from './driver-context';
import { createMileageDeduction, type MileageDeduction } from './mileage-deduction';
import { createCaptureStore, stateOf } from './diagnostics/capture';
import { openDiagnosticsStore, type DiagnosticsStore } from './diagnostics/store';
import { csvExporter } from './exporters/csv';
import { geojsonExporter, gpxExporter } from './exporters/geo';
import { createExporterRegistry, type ExporterRegistry } from './exporters/registry';
import { pdfExporter } from './exporters/pdf';
import { expensesExporter, taxSummaryExporter } from './exporters/reports';
import { serverModules, type ServerModule } from './modules';
import { shiftPresenter, type ShiftPresenter } from './processing/presenter';
import { createShiftBook, type ShiftBook } from './processing/shift-book';
import { receiptsDirOf } from './receipts/store';
import { createEarningsPolicy, type EarningsPolicy } from './routes/earnings';
import { availableFormats } from './routes/exports';
import { taxDeductionMethods } from './routes/tax';
import { settingsReader } from './routes/settings';
import { createServerState, type ServerState } from './state';

export type Log = (message: string, fields?: object) => void;

/** Shorter intervals and test seams. Production leaves them out and gets the defaults. */
export interface ServerTuning {
  /** Debounce of the recompute after late points (5 s). */
  lateRecomputeMs?: number;
  /** Interval of the raw-point retention job (a day). */
  archiveEveryMs?: number;
  /** Interval of `server.sample` and `api.window` (15 minutes). */
  diagnosticsSampleMs?: number;
  /** Interval of the diagnostics retention job (a day). */
  diagnosticsHousekeepingMs?: number;
  /** Interval of the 30 day capture purge (a day). */
  captureHousekeepingMs?: number;
  /** Passed to the restore service (forces a revert). */
  restoreVerify?: (db: Db) => void;
  /** Exporters in place of csv, gpx, geojson, expenses, tax_summary and pdf. */
  exporters?: ExporterRegistry;
}

/** What a server is assembled from. `start.ts` fills it from the environment; tests from a temp folder. */
export interface ServerInput {
  /** The open, migrated database. The caller closes it. */
  db: Db;
  /** The owner's configuration (`loadConfig`), `settings.json` included. */
  config: ServerConfig;
  /** The environment: `MILEWAGE_MODULE_<NAME>` and `MILEWAGE_MODULE_EXPORT_<FORMAT>` override `settings.json`. */
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  log?: Log;
  /** Server mode, shared with the upgrade step; a restore in progress answers 503 to everything else. */
  state?: ServerState;
  /** Free-space rules (10 section 11.3); omitted means plenty of room. */
  disk?: DiskMonitor;
  /** The backup service the upgrade step used, so setup, migration and restore share one. */
  backup?: BackupService;
  /** Start the nightly 03:30 backup job. */
  nightlyBackups?: boolean;
  /** Where log lines go (stdout when omitted). */
  logStream?: { write(line: string): void };
  /** Told when an unreadable diagnostics.db was moved aside and a new one made. */
  onDiagnosticsRecreated?: (movedTo: string, reason: string) => void;
  tuning?: ServerTuning;
}

/**
 * What every module is wired from: the registry and the bus, which exist before any module, the
 * configuration, and the services more than one module uses.
 */
export interface ServerHost {
  readonly db: Db;
  readonly now: () => number;
  readonly log?: Log;
  readonly registry: ModuleRegistry<ServerModule>;
  readonly bus: EventBus;
  readonly config: ServerConfig;
  readonly tuning: ServerTuning;
  readonly state: ServerState;
  readonly disk?: DiskMonitor;
  readonly nightlyBackups: boolean;
  readonly authn: Authenticator;
  /** `config/secrets.json`: the public key new backups are encrypted to. */
  readonly secrets: SecretsStore;
  readonly backup: BackupService;
  /** The owner's settings as the server sees them, read once per request or job. */
  readonly drivers: DriverContexts;
  /** Mileage deductions and deduction methods; the method comes from the `tax` module while it is on. */
  readonly deduction: MileageDeduction;
  /** The `Shift` object of the API, with flags and deduction. */
  readonly present: ShiftPresenter;
  /** Records, recomputes and announces every shift; the device read window. */
  readonly book: ShiftBook;
  /** diagnostics.db, opened on first use; only the diagnostics and capture modules and the status page read it. */
  readonly diagnostics: { store: () => DiagnosticsStore; path: string; close(): void };
  /** The `Settings` response for a user (core, devices on pairing, sync). */
  readonly readSettings: (userId: number, deviceId?: number) => object;
  /** The active capture session of a device, for `diagnostics.capture` in the settings. */
  readonly captureFor: (userId: number, deviceId: number) => object | null;
  readonly exporters: ExporterRegistry;
  /** Formats switched on in the configuration (`modules.export_<format>`). */
  readonly formatsOn: readonly string[];
  /** Formats that exist right now: the exporters module on, switched on, required modules on. */
  readonly exportFormats: (reg: ModuleRegistry) => string[];
  readonly earningsPolicy: (reg: ModuleRegistry) => EarningsPolicy;
}

export interface App {
  fastify: FastifyInstance;
  registry: ModuleRegistry<ServerModule>;
  bus: EventBus;
}

/**
 * Assembles the server: the module registry and the event bus first, then the shared services, then
 * each module that is on wires itself, then its routes, subscriptions and jobs are installed. A
 * module that is off is never wired: its routes answer 404 and it has no jobs and no listeners.
 * Throws ModuleConfigError for an invalid module configuration and ConfigError for a bad switch.
 * Jobs stop when `fastify` closes.
 */
export function assembleServer(input: ServerInput): App {
  const env = input.env ?? {};
  const registry = buildRegistry(
    serverModules,
    resolveModuleConfig(serverModules, input.config.settings, env),
  );
  const bus = createEventBus();
  const host = shareServices(input, registry, bus);
  const parts = registry.enabled.map((m) => m.wire?.(host) ?? {});

  const { db, config } = input;
  const state = host.state;
  const identity = createInstanceReader(db);
  const fastify = buildHttpApp(
    {
      logLevel: config.logLevel,
      logStream: input.logStream,
      trustProxy: config.trustProxy,
      now: host.now,
      state,
      disk: input.disk && (() => input.disk!.state()),
      // The old schema may lack columns the current code selects; skip the headers until it is upgraded.
      identity: () => (state.mode === 'normal' ? identity() : undefined),
      isHealthy: () => db.prepare('SELECT 1').pluck().get() === 1,
    },
    (api) => {
      const routeHost = { app: api, registry, bus };
      for (const p of parts) p.routes?.(routeHost);
    },
  );
  for (const p of parts) {
    for (const [event, handler] of Object.entries(p.subscriptions ?? {})) {
      bus.on(event as never, handler as never);
    }
  }
  const stops = parts.flatMap((p) => (p.jobs ?? []).map((j) => j.start()));
  fastify.addHook('onClose', () => stops.forEach((stop) => stop()));
  return { fastify, registry, bus };
}

/** The default exporters (08 sections 11 and 16.3); a new format registers here without other edits. */
export const serverExporters = () =>
  createExporterRegistry([
    csvExporter,
    gpxExporter,
    geojsonExporter,
    expensesExporter,
    taxSummaryExporter,
    pdfExporter,
  ]);

/** Builds the backup service for a connection; the time zone is the owner's, UTC before setup. */
export function buildBackupService(o: {
  db: Db;
  now: () => number;
  backupDir?: string;
  configDir?: string;
  secrets?: SecretsStore;
  disk?: DiskMonitor;
}) {
  // Only the owner's time zone is read here.
  const drivers = createDriverContexts({ db: o.db, now: o.now, stopsModule: () => false });
  const instance = createInstanceReader(o.db);
  return createBackupService({
    db: o.db,
    dir: o.backupDir ?? 'backups',
    now: o.now,
    disk: o.disk,
    codec: secretsCodec(o.secrets ?? fileSecrets(o.configDir ?? 'config')),
    receiptsDir: receiptsDirOf(o.db),
    // Scheduled backups wait for the recovery key to be confirmed (08 section 2.3).
    ready: () => instance()?.setupConfirmedAt != null,
    timeZone: () => drivers.owner()?.timeZone ?? 'UTC',
  });
}

/** The services more than one module uses, built once, before any module. */
function shareServices(
  input: ServerInput,
  registry: ModuleRegistry<ServerModule>,
  bus: EventBus,
): ServerHost {
  const { db, config, disk } = input;
  const now = input.now ?? Date.now;
  const secrets = fileSecrets(config.configDir);
  const backup =
    input.backup ??
    buildBackupService({
      db,
      now,
      backupDir: config.backupDir,
      configDir: config.configDir,
      secrets,
      disk,
    });
  // Every finished run is a fact on the bus, whichever modules are on (diagnostics).
  backup.onFinished((r) => bus.emit('backup.finished', r));

  const diagnosticsPath = join(config.dataDir, 'diagnostics.db');
  let store: DiagnosticsStore | undefined;
  const diagnostics = {
    path: diagnosticsPath,
    store: () =>
      (store ??= openDiagnosticsStore(diagnosticsPath, now, input.onDiagnosticsRecreated)),
    close: () => store?.close(),
  };
  const captureFor = (_userId: number, deviceId: number) => {
    if (!registry.isEnabled('capture')) return null;
    const c = createCaptureStore(diagnostics.store().db);
    const id = c.activeFor(deviceId, now())[0];
    const s = id === undefined ? undefined : c.session(id);
    return s && stateOf(s, now()) === 'active'
      ? {
          id: s.id,
          profile: s.profile,
          expires_at: s.expiresAt,
          max_shifts: s.maxShifts,
          shifts_done: c.shiftsDone(s.id),
        }
      : null;
  };

  const drivers = createDriverContexts({
    db,
    now,
    stopsModule: () => registry.isEnabled('stops'),
  });
  const deduction = createMileageDeduction({
    db,
    drivers,
    methods: registry.isEnabled('tax') ? taxDeductionMethods(db) : undefined,
  });
  const tuning = input.tuning ?? {};
  const exporters = tuning.exporters ?? serverExporters();
  const formatsOn = exportFormatsOn(exporters.formats(), config.settings, input.env ?? {});
  const exportFormats = (reg: ModuleRegistry) =>
    reg.isEnabled('exporters')
      ? availableFormats(
          exporters,
          (m) => reg.isEnabled(m),
          () => formatsOn,
        )
      : [];

  return {
    db,
    now,
    log: input.log,
    registry,
    bus,
    config,
    tuning,
    state: input.state ?? createServerState(),
    disk,
    nightlyBackups: input.nightlyBackups ?? false,
    authn: new Authenticator(createSessionRepository(db), now),
    drivers,
    deduction,
    present: shiftPresenter(db, deduction),
    secrets,
    backup,
    book: createShiftBook({
      db,
      now,
      drivers,
      emit: bus.emit,
      trackingModule: () => registry.isEnabled('tracking'),
      stopsModule: () => registry.isEnabled('stops'),
    }),
    diagnostics,
    readSettings: settingsReader({
      drivers,
      now,
      registry,
      countries: countryModules.codes(),
      backupDownload: config.backup.download,
      exportFormats,
      captureFor,
    }),
    captureFor,
    exporters,
    formatsOn,
    exportFormats,
    earningsPolicy: (reg) => createEarningsPolicy(drivers, reg, config.comma.earningsOverride),
  };
}
