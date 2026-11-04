import { ModuleConfigError, type EnabledMap } from './registry';
import type { ModuleDefinition } from './module';

export type ModuleSettings = { modules?: Record<string, unknown> };

// Flags: module default, then config/settings.json, then MILEWAGE_MODULE_<NAME>=0|1 (08 section 16.1).
export function resolveModuleConfig(
  modules: readonly ModuleDefinition[],
  settings: ModuleSettings = {},
  env: Readonly<Record<string, string | undefined>> = {},
): EnabledMap {
  const result: Record<string, boolean> = {};
  for (const m of modules) {
    let value = m.defaultEnabled ?? true;
    const fromFile = settings.modules?.[m.name];
    if (fromFile !== undefined) {
      if (typeof fromFile !== 'boolean') {
        throw new ModuleConfigError(`settings.modules.${m.name} must be true or false.`);
      }
      value = fromFile;
    }
    const key = `MILEWAGE_MODULE_${m.name.toUpperCase()}`;
    const fromEnv = env[key];
    if (fromEnv !== undefined && fromEnv !== '') {
      if (fromEnv !== '0' && fromEnv !== '1')
        throw new ModuleConfigError(`${key} must be 0 or 1, got "${fromEnv}".`);
      value = fromEnv === '1';
    }
    result[m.name] = value;
  }
  return result;
}
