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
  /** `MILEWAGE_BACKUP_DIR`: the `backups` volume. */
  backupDir: string;
  logLevel: string;
  /** `MILEWAGE_TRUST_PROXY`: comma-separated proxy addresses or CIDRs, or `true`. Empty means no proxy is trusted. */
  trustProxy: boolean | string[];
  settings: ModuleSettings;
  /** `backup.on_shift_end` and `backup.download` (10 section 3.1): both on by default. */
  backup: { onShiftEnd: boolean; download: boolean };
  /** `diagnostics.bundle` (16 section 11): the debug-bundle route; on by default. */
  diagnostics: { bundle: boolean };
}

/** Export formats switched on: `modules.export_<format>` in the settings file, then `MILEWAGE_MODULE_EXPORT_<FORMAT>=0|1` (08 section 16.1). */
export function exportFormatsOn(
  formats: readonly string[],
  settings: ModuleSettings,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return formats.filter((f) => {
    const fromEnv = env[`MILEWAGE_MODULE_EXPORT_${f.toUpperCase()}`];
    if (fromEnv !== undefined && fromEnv !== '') {
      if (fromEnv !== '0' && fromEnv !== '1') {
        throw new ConfigError(`MILEWAGE_MODULE_EXPORT_${f.toUpperCase()} must be 0 or 1.`);
      }
      return fromEnv === '1';
    }
    const fromFile = settings.modules?.[`export_${f}`];
    if (fromFile !== undefined && typeof fromFile !== 'boolean') {
      throw new ConfigError(`settings.modules.export_${f} must be true or false.`);
    }
    return fromFile ?? true;
  });
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const port = Number(env.MILEWAGE_PORT ?? '8080');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(
      `MILEWAGE_PORT must be a whole number from 0 to 65535, got "${env.MILEWAGE_PORT}".`,
    );
  }
  const configDir = env.MILEWAGE_CONFIG_DIR ?? 'config';
  const settings = readSettingsFile(join(configDir, 'settings.json'));
  const file = (settings as { backup?: { on_shift_end?: unknown; download?: unknown } }).backup;
  return {
    host: env.MILEWAGE_HOST ?? '0.0.0.0',
    port,
    dataDir: env.MILEWAGE_DATA_DIR ?? 'data',
    configDir,
    backupDir: env.MILEWAGE_BACKUP_DIR ?? 'backups',
    logLevel: env.MILEWAGE_LOG_LEVEL ?? 'info',
    trustProxy: parseTrustProxy(env.MILEWAGE_TRUST_PROXY),
    settings,
    backup: {
      onShiftEnd: flag(env.MILEWAGE_BACKUP_ON_SHIFT_END, file?.on_shift_end, 'backup.on_shift_end'),
      download: flag(env.MILEWAGE_BACKUP_DOWNLOAD, file?.download, 'backup.download'),
    },
    diagnostics: {
      bundle: flag(
        env.MILEWAGE_DIAGNOSTICS_BUNDLE,
        (settings as { diagnostics?: { bundle?: unknown } }).diagnostics?.bundle,
        'diagnostics.bundle',
      ),
    },
  };
}

/** A switch: default on, then `config/settings.json`, then the environment (`0` or `1`). */
function flag(env: string | undefined, file: unknown, name: string): boolean {
  if (env !== undefined && env !== '') {
    if (env !== '0' && env !== '1') throw new ConfigError(`The switch for ${name} must be 0 or 1.`);
    return env === '1';
  }
  if (file === undefined) return true;
  if (typeof file !== 'boolean') throw new ConfigError(`settings.${name} must be true or false.`);
  return file;
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

function parseTrustProxy(value: string | undefined): boolean | string[] {
  const list = (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length === 1 && list[0] === 'true' ? true : list;
}
