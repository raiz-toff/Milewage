/** A timer or other background work a module runs while the server is up; `start` returns its stop. */
export interface ModuleJob {
  name: string;
  start(): () => void;
}

/**
 * What the module graph knows of a module: its name, what it needs and whether the owner may switch
 * it off. What the module does (routes, jobs, event subscriptions) is the server's business: the
 * server extends this type with its own wiring and builds only the modules that are on.
 */
export interface ModuleDefinition {
  name: string;
  dependsOn: readonly string[];
  /** Default for `modules.<name>` when no setting or env override exists. Default true. */
  defaultEnabled?: boolean;
  toggleable?: boolean;
}

export function defineModule<M extends ModuleDefinition>(definition: M): Readonly<M> {
  if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
    throw new Error(
      `Invalid module name "${definition.name}": use lowercase letters, digits and underscores.`,
    );
  }
  return Object.freeze({ ...definition, dependsOn: Object.freeze([...definition.dependsOn]) });
}
