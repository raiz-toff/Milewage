import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveModuleConfig } from '@milewage/shared';
import { buildApp, type App } from './app';
import { loadConfig } from './config';
import { createInstanceReader, openAndMigrate, type Db } from './db';
import { createServerModules, serverModules } from './modules';
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
  const db = openAndMigrate(join(config.dataDir, 'milewage.db'));
  try {
    const app = buildApp({
      modules: createServerModules({
        db,
        now: Date.now,
        backupDir: config.backupDir,
        configDir: config.configDir,
        state,
        backupSchedule: true,
        log: (message, fields) => console.log(JSON.stringify({ msg: message, ...fields })),
        diagnosticsPath: join(config.dataDir, 'diagnostics.db'),
        onDiagnosticsRecreated: (movedTo, reason) =>
          console.warn(JSON.stringify({ msg: 'diagnostics.db recreated', movedTo, reason })),
      }),
      enabled,
      logLevel: config.logLevel,
      trustProxy: config.trustProxy,
      state,
      identity: createInstanceReader(db),
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
