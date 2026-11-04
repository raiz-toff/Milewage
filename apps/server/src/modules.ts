import { defineModule } from '@milewage/shared';
import { coreRoutes, type CoreContext } from './routes/core';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });

export const serverModules = [coreModule] as const;

export const createServerModules = (ctx: CoreContext) =>
  [defineModule({ ...coreModule, routes: coreRoutes(ctx) })] as const;
