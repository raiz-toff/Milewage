import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleSettings } from '@milewage/shared';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  configDir: string;
  logLevel: string;
  settings: ModuleSettings;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const port = Number(env.MILEWAGE_PORT ?? '8080');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(
      `MILEWAGE_PORT must be a whole number from 0 to 65535, got "${env.MILEWAGE_PORT}".`,
    );
  }
  const configDir = env.MILEWAGE_CONFIG_DIR ?? 'config';
  return {
    host: env.MILEWAGE_HOST ?? '0.0.0.0',
    port,
    dataDir: env.MILEWAGE_DATA_DIR ?? 'data',
    configDir,
    logLevel: env.MILEWAGE_LOG_LEVEL ?? 'info',
    settings: readSettingsFile(join(configDir, 'settings.json')),
  };
}

function readSettingsFile(path: string): ModuleSettings {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError(`Cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as ModuleSettings;
  } catch {
    throw new ConfigError(`${path} is not valid JSON (expected an object).`);
  }
}
