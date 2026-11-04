import type { EventSubscriptions } from './events';

export interface RouteHost {
  route(method: string, path: string, handler: (request: unknown) => unknown): void;
}

export interface ModuleJob {
  name: string;
  start(): () => void;
}

export interface ModuleDefinition {
  name: string;
  dependsOn: readonly string[];
  routes?: (host: RouteHost) => void;
  jobs?: readonly ModuleJob[];
  subscriptions?: EventSubscriptions;
  /** Default for `modules.<name>` when no setting or env override exists. Default true. */
  defaultEnabled?: boolean;
  toggleable?: boolean;
}

export function defineModule(definition: ModuleDefinition): Readonly<ModuleDefinition> {
  if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
    throw new Error(
      `Invalid module name "${definition.name}": use lowercase letters, digits and underscores.`,
    );
  }
  return Object.freeze({ ...definition, dependsOn: Object.freeze([...definition.dependsOn]) });
}
