import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import {
  defineModule,
  DIAGNOSED_MODULES,
  type EventSubscriptions,
  type ModuleDefinition,
  type ModuleJob,
} from '@milewage/shared';
import type { ServerRouteHost } from './app';
import type { ServerHost } from './assembly';
import { nightlyBackupJob } from './backup/schedule';
import { createRestoreService } from './backup/restore';
import { createBackupRepository, createShiftRepository } from './db';
import { createDiagnosticsKeeper } from './diagnostics/keeper';
import { createServerMetrics } from './diagnostics/metrics';
import { createServerRecorder, effectiveLevel } from './diagnostics/recorder';
import { createArchiver } from './processing/archive';
import { createLateRecompute } from './processing/late-recompute';
import { receiptsDirOf } from './receipts/store';
import { taxReport } from './tax-report';
import { SERVER_VERSION } from './version';
import { backupRoutes } from './routes/backup';
import { coreRoutes } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { diagnosticsRoutes } from './routes/diagnostics';
import { earningsRoutes } from './routes/earnings';
import { expensesRoutes } from './routes/expenses';
import { exportsRoutes } from './routes/exports';
import { platformKnown, platformsRoutes } from './routes/platforms';
import { receiptsRoutes } from './routes/receipts';
import { restoreRoutes } from './routes/restore';
import { stopsRoutes } from './routes/stops';
import { createSync } from './routes/sync';
import { taxRoutes } from './routes/tax';
import { shiftRouteRoutes } from './routes/shift-route';
import { trackingRoutes } from './routes/tracking';

/** What a module gives the server once it is wired. None of it exists while the module is off. */
export interface ModuleParts {
  /** Registers the module's routes under `/api/v1`. */
  routes?: (host: ServerRouteHost) => void;
  jobs?: readonly ModuleJob[];
  subscriptions?: EventSubscriptions;
}

/** A server module: its place in the module graph and how it wires itself from the server host. */
export interface ServerModule extends ModuleDefinition {
  /** Called once when the server is assembled, only if the module is on, before any route exists. */
  wire?: (host: ServerHost) => ModuleParts;
}

const serverModule = (m: ServerModule) => defineModule(m);

/** The free-space state, for the parts that only read it. */
const diskState = (h: ServerHost) => h.disk && (() => h.disk!.state());
const ownerOf = (h: ServerHost) => () => createBackupRepository(h.db).ownerId();

/**
 * Every server module, once. Adding a module is one entry here (and its route file). The order is
 * the order routes, hooks, subscriptions and jobs are installed in, dependencies first.
 */
export const serverModules = [
  serverModule({
    name: 'core',
    dependsOn: [],
    toggleable: false,
    wire: (h) => ({
      routes: coreRoutes(
        {
          db: h.db,
          now: h.now,
          secrets: h.secrets,
          book: h.book,
          exportFormats: h.exportFormats,
          backupDownload: h.config.backup.download,
          comma: h.config.comma,
          drivers: h.drivers,
          deduction: h.deduction,
          present: h.present,
          status: {
            state: h.state,
            disk: h.disk,
            lastBackup: () => h.backup.list()[0],
            lastBackupFailure: () => h.backup.lastFailure(),
            diagnostics: (userId) => ({
              level: h.drivers.of(userId).settings.diagnosticsLevel,
              db_bytes: h.diagnostics.store().bytes(),
              event_count: h.diagnostics.store().count(),
            }),
          },
        },
        h.authn,
      ),
    }),
  }),
  serverModule({
    name: 'devices',
    dependsOn: ['core'],
    wire: (h) => ({
      routes: devicesRoutes({
        db: h.db,
        now: h.now,
        authn: h.authn,
        readSettings: h.readSettings,
        apkPath: h.config.apkPath,
        publicUrl: h.config.publicUrl,
        homeUrl: h.config.homeUrl,
        httpAddressAllowed: h.config.httpAddressAllowed,
        appStoreUrl: h.config.appStoreUrl,
      }),
    }),
  }),
  serverModule({
    name: 'tracking',
    dependsOn: ['core', 'devices'],
    wire: (h) => {
      const late = createLateRecompute({
        db: h.db,
        book: h.book,
        delayMs: h.tuning.lateRecomputeMs,
        log: h.log,
      });
      const archiver = createArchiver({
        db: h.db,
        now: h.now,
        emit: h.bus.emit,
        everyMs: h.tuning.archiveEveryMs,
        log: h.log,
      });
      const tracking = trackingRoutes(h);
      // The route a shift's map draws (08 section 3).
      const route = shiftRouteRoutes(h);
      return {
        routes: (host) => {
          tracking(host);
          route(host);
        },
        subscriptions: late.subscriptions,
        jobs: [late.job, archiver.job],
      };
    },
  }),
  /** Derived stops and the driver's optional labels; the runtime toggle is `settings.stops_enabled` (08 section 16.1). */
  serverModule({
    name: 'stops',
    dependsOn: ['core', 'tracking'],
    wire: (h) => ({
      routes: stopsRoutes({
        ...h,
        platformOk: (userId, slug) =>
          !h.registry.isEnabled('platforms') || platformKnown(h.db, userId, slug),
      }),
    }),
  }),
  /** The driver's platforms: built-ins plus their own, with overrides (18 section 4.2). */
  serverModule({
    name: 'platforms',
    dependsOn: ['core'],
    wire: (h) => ({ routes: platformsRoutes(h) }),
  }),
  /** Expenses, categories and recurring reminders (18 section 5). */
  serverModule({
    name: 'expenses',
    dependsOn: ['core'],
    wire: (h) => ({ routes: expensesRoutes(h) }),
  }),
  /** One receipt photo or PDF per expense, kept on the volume and in every backup (18 section 5.4). */
  serverModule({
    name: 'receipts',
    dependsOn: ['expenses'],
    wire: (h) => ({ routes: receiptsRoutes(h) }),
  }),
  /** The Tax Center: an estimate, never a filing (18 section 7). CA only until other packs are verified. */
  serverModule({
    name: 'tax',
    dependsOn: ['core'],
    wire: (h) => ({
      routes: taxRoutes({
        ...h,
        countries: h.config.comma.taxCountries,
        override: h.config.comma.earningsOverride,
      }),
    }),
  }),
  /** The driver's typed payout per shift and platform (18 section 4.3). */
  serverModule({
    name: 'earnings',
    dependsOn: ['core'],
    wire: (h) => ({ routes: earningsRoutes({ ...h, policy: h.earningsPolicy }) }),
  }),
  /** The pull path for the phone (15 section 6.5): `change_log`, `overwrite_log`, `GET /sync/changes`. */
  serverModule({
    name: 'sync',
    dependsOn: ['core', 'devices'],
    wire: (h) => createSync(h),
  }),
  /** `GET /exports/{format}`; each format is a registered exporter (08 sections 11 and 16.3). */
  serverModule({
    name: 'exporters',
    dependsOn: ['core'],
    wire: (h) => ({
      routes: exportsRoutes({
        ...h,
        formats: () => h.formatsOn,
        earnings: h.earningsPolicy,
        taxReport: (reg, userId, year) =>
          taxReport(
            {
              db: h.db,
              drivers: h.drivers,
              deduction: h.deduction,
              registry: reg,
              countries: h.config.comma.taxCountries,
              override: h.config.comma.earningsOverride,
            },
            userId,
            year,
          ),
      }),
    }),
  }),
  serverModule({
    name: 'diagnostics',
    dependsOn: ['core'],
    wire: (h) => {
      const { store } = h.diagnostics;
      const keeper = createDiagnosticsKeeper({
        store,
        now: h.now,
        disk: diskState(h),
        owner: ownerOf(h),
        version: SERVER_VERSION,
        everyMs: h.tuning.diagnosticsHousekeepingMs,
        log: h.log,
      });
      const recorder = createServerRecorder({
        store,
        now: h.now,
        owner: ownerOf(h),
        level: (userId) => effectiveLevel(h.drivers.find(userId)?.settings, h.now()),
        disk: diskState(h),
        version: SERVER_VERSION,
        shiftClientId: (id) => createShiftRepository(h.db).byId(id)?.clientId,
        drop: (reason) => keeper.drop(reason),
      });
      const diag = h.diagnostics.path;
      const metrics = createServerMetrics({
        recorder,
        now: h.now,
        disk: h.disk,
        everyMs: h.tuning.diagnosticsSampleMs,
        paths: () => ({
          db: h.db.name,
          diag,
          bytes: (f) => {
            try {
              return statSync(f).size;
            } catch {
              return 0;
            }
          },
        }),
        modules: () =>
          Object.fromEntries(DIAGNOSED_MODULES.map((m) => [m, h.registry.isEnabled(m)])),
        schemaVersion: () =>
          String(h.db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()),
        sqliteVersion: () => String(h.db.prepare('SELECT sqlite_version()').pluck().get()),
        markerPath: diag === ':memory:' ? undefined : `${diag}.running`,
      });
      return {
        routes: diagnosticsRoutes({
          ...h,
          store,
          disk: diskState(h),
          onDrop: (reason) => keeper.drop(reason),
          observe: metrics.install,
          bundle: h.config.diagnostics.bundle,
          lastBackupAt: () => h.backup.list().find((r) => r.integrityOk === 1)?.createdAt,
        }),
        subscriptions: { ...recorder.subscriptions, ...metrics.subscriptions },
        jobs: [
          { name: 'diagnostics-store', start: () => () => h.diagnostics.close() },
          keeper.job(),
          metrics.job,
        ],
      };
    },
  }),
  /** The backup engine is never toggled off: the server holds the only copy of the data (10 section 3.1). */
  serverModule({
    name: 'backup',
    dependsOn: ['core'],
    toggleable: false,
    wire: (h) => {
      const restore = createRestoreService({
        db: h.db,
        backup: h.backup,
        secrets: h.secrets,
        state: h.state,
        verify: h.tuning.restoreVerify,
        receiptsDir: receiptsDirOf(h.db),
        log: h.log,
      });
      const uploadDir = join(dirname(h.db.name), '.restore-upload');
      return {
        routes: (host) => {
          backupRoutes({
            ...h,
            service: h.backup,
            download: h.config.backup.download,
          })(host);
          restoreRoutes({ restore, uploadDir, now: h.now })(host);
        },
        jobs: h.nightlyBackups ? [nightlyBackupJob(h.backup, h.now, h.log)] : [],
        subscriptions: h.config.backup.onShiftEnd
          ? {
              'shift.ended'() {
                // One manual or shift-end backup per 15 minutes for the instance (10 section 13).
                const last = h.backup.lastRunAt(['manual', 'shift_end']);
                if (last !== undefined && h.now() - last < 15 * 60_000) return;
                h.backup
                  .run('shift_end')
                  .catch((e: Error) => h.log?.('shift-end backup failed', { error: e.message }));
              },
            }
          : {},
      };
    },
  }),
] as const;
