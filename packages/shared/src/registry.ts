import type { EventBus } from './events';
import type { ModuleDefinition, RouteHost } from './module';

export class ModuleConfigError extends Error {
  override name = 'ModuleConfigError';
}

export type EnabledMap = Readonly<Record<string, boolean>>;

export interface ModuleRegistry {
  readonly enabled: readonly Readonly<ModuleDefinition>[];
  isEnabled(name: string): boolean;
  flags(): Record<string, boolean>;
  registerRoutes(host: RouteHost): void;
  attachSubscriptions(bus: EventBus): () => void;
  startJobs(): () => void;
}

/** Builds the graph; throws ModuleConfigError on duplicates, unknown deps, cycles, or an enabled module with a disabled dependency. */
export function buildRegistry(
  modules: readonly ModuleDefinition[],
  enabledMap: EnabledMap,
): ModuleRegistry {
  const byName = new Map<string, ModuleDefinition>();
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
    registerRoutes(host) {
      for (const m of enabled) m.routes?.(host);
    },
    attachSubscriptions(bus) {
      const detach: (() => void)[] = [];
      for (const m of enabled) {
        for (const [event, handler] of Object.entries(m.subscriptions ?? {})) {
          detach.push(bus.on(event as never, handler as never));
        }
      }
      return () => detach.forEach((d) => d());
    },
    startJobs() {
      const stops = enabled.flatMap((m) => (m.jobs ?? []).map((j) => j.start()));
      return () => stops.forEach((s) => s());
    },
  };
}

function topoSort(byName: Map<string, ModuleDefinition>): ModuleDefinition[] {
  const done = new Set<string>();
  const visiting: string[] = [];
  const out: ModuleDefinition[] = [];
  const visit = (name: string) => {
    if (done.has(name)) return;
    const at = visiting.indexOf(name);
    if (at >= 0) {
      throw new ModuleConfigError(
        `Module dependency cycle: ${[...visiting.slice(at), name].join(' -> ')}.`,
      );
    }
    visiting.push(name);
    const m = byName.get(name) as ModuleDefinition;
    m.dependsOn.forEach(visit);
    visiting.pop();
    done.add(name);
    out.push(m);
  };
  [...byName.keys()].forEach(visit);
  return out;
}
