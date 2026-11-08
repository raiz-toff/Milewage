import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ModuleSettings } from '@milewage/shared';
import { loadCommaOptions, type CommaOptions } from './comma-options';
import { checkHomeUrl, checkPublicUrl } from './public-url';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  configDir: string;
  /** `MILEWAGE_BACKUP_DIR`: the `backups` volume; by default `backups` next to the data folder. */
  backupDir: string;
  logLevel: string;
  /** `MILEWAGE_TRUST_PROXY`: comma-separated proxy addresses or CIDRs, or `true`. Empty means no proxy is trusted. */
  trustProxy: boolean | string[];
  settings: ModuleSettings;
  /** `backup.on_shift_end` and `backup.download` (10 section 3.1): both on by default. */
  backup: { onShiftEnd: boolean; download: boolean };
  /** `diagnostics.bundle` (16 section 11): the debug-bundle route; on by default. */
  diagnostics: { bundle: boolean };
  /** Answers to the open questions of 18 section 16 (`comma` in settings.json). */
  comma: CommaOptions;
  /** `MILEWAGE_APK_PATH`: the phone app this server hands out (plan 24 Q2); served only if present. */
  apkPath: string;
  /** `MILEWAGE_PUBLIC_URL`: the address phones are given (plan 19 section 3.2); null to use the request's. */
  publicUrl: string | null;
  /** `MILEWAGE_HOME_URL`: the server on the home network, http allowed (plan 28 section 4.2); null to use a home request's. */
  homeUrl: string | null;
  /** Plain http addresses are accepted only outside production (debug builds of the app). */
  httpAddressAllowed: boolean;
  /** `MILEWAGE_APP_STORE_URL`: the app's store page (an https link), shown on the download page; null until published. */
  appStoreUrl: string | null;
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
  const httpAddressAllowed = env.NODE_ENV !== 'production';
  const dataDir = env.MILEWAGE_DATA_DIR ?? 'data';
  const file = (settings as { backup?: { on_shift_end?: unknown; download?: unknown } }).backup;
  return {
    host: env.MILEWAGE_HOST ?? '0.0.0.0',
    port,
    dataDir,
    configDir,
    // Beside the data folder (`/app/data` and `/app/backups` in the image), so a server given only
    // MILEWAGE_DATA_DIR never writes backups into whatever folder it was started from.
    backupDir: env.MILEWAGE_BACKUP_DIR ?? join(dirname(dataDir), 'backups'),
    logLevel: env.MILEWAGE_LOG_LEVEL ?? 'info',
    trustProxy: parseTrustProxy(env.MILEWAGE_TRUST_PROXY),
    settings,
    backup: {
      onShiftEnd: flag(env.MILEWAGE_BACKUP_ON_SHIFT_END, file?.on_shift_end, 'backup.on_shift_end'),
      download: flag(env.MILEWAGE_BACKUP_DOWNLOAD, file?.download, 'backup.download'),
    },
    comma: loadCommaOptions(settings, env),
    apkPath: env.MILEWAGE_APK_PATH || join(configDir, 'milewage.apk'),
    publicUrl: publicUrl(env.MILEWAGE_PUBLIC_URL, httpAddressAllowed),
    homeUrl: homeUrl(env.MILEWAGE_HOME_URL),
    httpAddressAllowed,
    appStoreUrl: storeUrl(env.MILEWAGE_APP_STORE_URL),
    diagnostics: {
      bundle: flag(
        env.MILEWAGE_DIAGNOSTICS_BUNDLE,
        (settings as { diagnostics?: { bundle?: unknown } }).diagnostics?.bundle,
        'diagnostics.bundle',
      ),
    },
  };
}

function publicUrl(value: string | undefined, allowHttp: boolean): string | null {
  if (!value?.trim()) return null;
  const checked = checkPublicUrl(value, allowHttp);
  if ('error' in checked) throw new ConfigError(`MILEWAGE_PUBLIC_URL "${value}": ${checked.error}`);
  return checked.url;
}

function homeUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const checked = checkHomeUrl(value);
  if ('error' in checked) throw new ConfigError(`MILEWAGE_HOME_URL "${value}": ${checked.error}`);
  return checked.url;
}

function storeUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  let u: URL | null = null;
  try {
    u = new URL(value.trim());
  } catch {
    // reported below
  }
  if (!u || u.protocol !== 'https:' || u.username || u.password) {
    throw new ConfigError(
      `MILEWAGE_APP_STORE_URL must be an https link, for example https://play.google.com/store/apps/details?id=<package>; got "${value}".`,
    );
  }
  return u.href;
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
