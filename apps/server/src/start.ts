import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveModuleConfig } from '@milewage/shared';
import { buildApp, type App } from './app';
import { exportFormatsOn, loadConfig } from './config';
import {
  createInstanceReader,
  loadMigrations,
  MIGRATIONS_DIR,
  openDatabase,
  upgradeDatabase,
  type Db,
} from './db';
import { createDiskMonitor } from './disk';
import { buildBackupService, createServerModules, serverModules } from './modules';
import { createServerState } from './state';

export interface RunningServer extends App {
  db: Db;
}

export async function startServer(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RunningServer> {
  const config = loadConfig(env);
  const enabled = resolveModuleConfig(serverModules, config.settings, env);
  mkdirSync(config.dataDir, { recursive: true });
  const state = createServerState();
  const log = (message: string, fields?: object) =>
    console.log(JSON.stringify({ msg: message, ...fields }));
  const dbPath = join(config.dataDir, 'milewage.db');
  const disk = createDiskMonitor({ dir: config.dataDir, dbPath, now: Date.now });
  const db = openDatabase(dbPath);
  try {
    const backup = buildBackupService({
      db,
      now: Date.now,
      backupDir: config.backupDir,
      configDir: config.configDir,
      disk,
    });
    // A newer database is refused here (the process exits); a backup or migration failure leaves the
    // old schema in place and the server up in read-only mode (10 section 10).
    await upgradeDatabase({ db, backup, state, migrations: loadMigrations(MIGRATIONS_DIR), log });
    const identity = createInstanceReader(db);
    const app = buildApp({
      modules: createServerModules({
        db,
        now: Date.now,
        backup,
        disk,
        backupDir: config.backupDir,
        configDir: config.configDir,
        apkPath: config.apkPath,
        publicUrl: config.publicUrl,
        httpAddressAllowed: config.httpAddressAllowed,
        state,
        backupSchedule: state.mode === 'normal',
        enabledExportFormats: () =>
          exportFormatsOn(
            ['csv', 'pdf', 'gpx', 'geojson', 'expenses', 'tax_summary'],
            config.settings,
            env,
          ),
        backupOnShiftEnd: config.backup.onShiftEnd,
        backupDownload: config.backup.download,
        diagnosticsBundle: config.diagnostics.bundle,
        comma: config.comma,
        log,
        diagnosticsPath: join(config.dataDir, 'diagnostics.db'),
        onDiagnosticsRecreated: (movedTo, reason) =>
          console.warn(JSON.stringify({ msg: 'diagnostics.db recreated', movedTo, reason })),
      }),
      enabled,
      logLevel: config.logLevel,
      trustProxy: config.trustProxy,
      state,
      disk: () => disk.state(),
      // The old schema may lack columns the current code selects; skip the headers until it is upgraded.
      identity: () => (state.mode === 'normal' ? identity() : undefined),
      isHealthy: () => db.prepare('SELECT 1').pluck().get() === 1,
    });
    app.fastify.addHook('onClose', () => void db.close());
    await app.fastify.listen({ host: config.host, port: config.port });
    return { ...app, db };
  } catch (e) {
    db.close();
    throw e;
  }
}
