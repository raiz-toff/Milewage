import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveModuleConfig } from '@milewage/shared';
import { buildApp, type App } from './app';
import { loadConfig } from './config';
import { openAndMigrate, type Db } from './db';
import { serverModules } from './modules';

export interface RunningServer extends App {
  db: Db;
}

export async function startServer(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RunningServer> {
  const config = loadConfig(env);
  const enabled = resolveModuleConfig(serverModules, config.settings, env);
  mkdirSync(config.dataDir, { recursive: true });
  const db = openAndMigrate(join(config.dataDir, 'milewage.db'));
  try {
    const app = buildApp({
      modules: serverModules,
      enabled,
      logLevel: config.logLevel,
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
