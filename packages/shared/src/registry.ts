import type { ModuleDefinition } from './module';

export class ModuleConfigError extends Error {
  override name = 'ModuleConfigError';
}

export type EnabledMap = Readonly<Record<string, boolean>>;

export interface ModuleRegistry<M extends ModuleDefinition = ModuleDefinition> {
  /** The modules that are on, dependencies first. */
  readonly enabled: readonly Readonly<M>[];
  isEnabled(name: string): boolean;
  /** Every module's switch, by name, dependencies first. */
  flags(): Record<string, boolean>;
}

/** Builds the graph; throws ModuleConfigError on duplicates, unknown deps, cycles, or an enabled module with a disabled dependency. */
export function buildRegistry<M extends ModuleDefinition>(
  modules: readonly M[],
  enabledMap: EnabledMap,
): ModuleRegistry<M> {
  const byName = new Map<string, M>();
  for (const m of modules) {
    if (byName.has(m.name)) throw new ModuleConfigError(`Module "${m.name}" is registered twice.`);
    byName.set(m.name, m);
  }
  for (const m of modules) {
    for (const dep of m.dependsOn) {
      if (!byName.has(dep))
        throw new ModuleConfigError(`Module "${m.name}" depends on unknown module "${dep}".`);
    }
  }
  const order = topoSort(byName);
  const on = (name: string) => enabledMap[name] ?? byName.get(name)?.defaultEnabled ?? true;
  for (const name of Object.keys(enabledMap)) {
    if (!byName.has(name))
      throw new ModuleConfigError(`Configuration names unknown module "${name}".`);
  }
  for (const m of order) {
    if (m.toggleable === false && !on(m.name)) {
      throw new ModuleConfigError(`Module "${m.name}" cannot be turned off.`);
    }
    if (!on(m.name)) continue;
    for (const dep of m.dependsOn) {
      if (!on(dep)) {
        throw new ModuleConfigError(
          `Module "${m.name}" is enabled but depends on "${dep}", which is disabled. Enable "${dep}" or disable "${m.name}".`,
        );
      }
    }
  }
  const enabled = order.filter((m) => on(m.name));
  return {
    enabled,
    isEnabled: (name) => byName.has(name) && on(name),
    flags: () => Object.fromEntries(order.map((m) => [m.name, on(m.name)])),
  };
}

function topoSort<M extends ModuleDefinition>(byName: Map<string, M>): M[] {
  const done = new Set<string>();
  const visiting: string[] = [];
  const out: M[] = [];
  const visit = (name: string) => {
    if (done.has(name)) return;
    const at = visiting.indexOf(name);
    if (at >= 0) {
      throw new ModuleConfigError(
        `Module dependency cycle: ${[...visiting.slice(at), name].join(' -> ')}.`,
      );
    }
    visiting.push(name);
    const m = byName.get(name) as M;
    m.dependsOn.forEach(visit);
    visiting.pop();
    done.add(name);
    out.push(m);
  };
  [...byName.keys()].forEach(visit);
  return out;
}
