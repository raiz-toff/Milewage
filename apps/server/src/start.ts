import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assembleServer, buildBackupService, type App } from './assembly';
import { loadConfig } from './config';
import { loadMigrations, MIGRATIONS_DIR, openDatabase, upgradeDatabase, type Db } from './db';
import { createDiskMonitor } from './disk';
import { createServerState } from './state';

export interface RunningServer extends App {
  db: Db;
}

export async function startServer(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RunningServer> {
  const config = loadConfig(env);
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
    const app = assembleServer({
      db,
      config,
      env,
      state,
      disk,
      backup,
      log,
      nightlyBackups: state.mode === 'normal',
      onDiagnosticsRecreated: (movedTo, reason) =>
        console.warn(JSON.stringify({ msg: 'diagnostics.db recreated', movedTo, reason })),
    });
    app.fastify.addHook('onClose', () => void db.close());
    await app.fastify.listen({ host: config.host, port: config.port });
    return { ...app, db };
  } catch (e) {
    db.close();
    throw e;
  }
}
