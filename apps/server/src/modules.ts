import { defineModule } from '@milewage/shared';
import { Authenticator } from './auth/authenticator';
import { createSessionRepository } from './db';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { trackingRoutes } from './routes/tracking';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });
export const devicesModule = defineModule({ name: 'devices', dependsOn: ['core'] });

export const trackingModule = defineModule({ name: 'tracking', dependsOn: ['core', 'devices'] });

export const serverModules = [coreModule, devicesModule, trackingModule] as const;

export function createServerModules(ctx: CoreContext) {
  const authn = new Authenticator(createSessionRepository(ctx.db), ctx.now);
  const countries = ctx.countries ?? DEFAULT_COUNTRIES;
  const readSettings = (host: { registry: Parameters<typeof settingsReader>[0]['registry'] }) =>
    settingsReader({ ...ctx, registry: host.registry, countries });
  return [
    defineModule({ ...coreModule, routes: coreRoutes(ctx, authn) }),
    defineModule({ ...devicesModule, routes: devicesRoutes({ ...ctx, authn, readSettings }) }),
    defineModule({ ...trackingModule, routes: trackingRoutes({ ...ctx, authn }) }),
  ] as const;
}
