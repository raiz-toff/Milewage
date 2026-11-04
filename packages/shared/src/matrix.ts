import type { ModuleDefinition } from './module';
import type { EnabledMap } from './registry';

export interface MatrixCase {
  label: string;
  enabled: EnabledMap;
  expectRefusal: boolean;
}

/** Module-matrix cases (08 section 16.6): all on, each module alone with its dependencies, and broken configurations. */
export function moduleMatrix(modules: readonly ModuleDefinition[]): MatrixCase[] {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const closure = (name: string, into = new Set<string>()): Set<string> => {
    if (!into.has(name)) {
      into.add(name);
      byName.get(name)?.dependsOn.forEach((d) => closure(d, into));
    }
    return into;
  };
  const make = (on: (name: string) => boolean) =>
    Object.fromEntries(modules.map((m) => [m.name, on(m.name)]));
  const cases: MatrixCase[] = [
    { label: 'all-on', enabled: make(() => true), expectRefusal: false },
  ];
  for (const m of modules) {
    const keep = closure(m.name);
    const enabled = make((n) => keep.has(n) || byName.get(n)?.toggleable === false);
    cases.push({ label: `only-${m.name}`, enabled, expectRefusal: false });
  }
  for (const m of modules) {
    const dep = m.dependsOn.find((d) => byName.get(d)?.toggleable !== false);
    if (dep) {
      const enabled = make((n) => n !== dep);
      cases.push({
        label: `missing-dependency-${m.name}-without-${dep}`,
        enabled,
        expectRefusal: true,
      });
    }
  }
  return cases;
}
