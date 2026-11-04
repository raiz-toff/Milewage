import { defineModule } from '@milewage/shared';
import { Authenticator } from './auth/authenticator';
import { createSessionRepository } from './db';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });
export const devicesModule = defineModule({ name: 'devices', dependsOn: ['core'] });

export const serverModules = [coreModule, devicesModule] as const;

export function createServerModules(ctx: CoreContext) {
  const authn = new Authenticator(createSessionRepository(ctx.db), ctx.now);
  const countries = ctx.countries ?? DEFAULT_COUNTRIES;
  const readSettings = (host: { registry: Parameters<typeof settingsReader>[0]['registry'] }) =>
    settingsReader({ ...ctx, registry: host.registry, countries });
  return [
    defineModule({ ...coreModule, routes: coreRoutes(ctx, authn) }),
    defineModule({ ...devicesModule, routes: devicesRoutes({ ...ctx, authn, readSettings }) }),
  ] as const;
}
