import { defineModule } from '@milewage/shared';
import { Authenticator } from './auth/authenticator';
import { createSessionRepository } from './db';
import { coreRoutes, type CoreContext } from './routes/core';
import { devicesRoutes } from './routes/devices';
import { trackingRoutes } from './routes/tracking';
import { diagnosticsRoutes } from './routes/diagnostics';
import { openDiagnosticsStore } from './diagnostics/store';
import { DEFAULT_COUNTRIES, settingsReader } from './routes/settings';

export const coreModule = defineModule({ name: 'core', dependsOn: [], toggleable: false });
export const devicesModule = defineModule({ name: 'devices', dependsOn: ['core'] });

export const trackingModule = defineModule({ name: 'tracking', dependsOn: ['core', 'devices'] });

export const diagnosticsModule = defineModule({ name: 'diagnostics', dependsOn: ['core'] });

export const serverModules = [
  coreModule,
  devicesModule,
  trackingModule,
  diagnosticsModule,
] as const;

export interface ServerContext extends CoreContext {
  /** Path of diagnostics.db (16 section 7.1); `:memory:` when omitted. Opened only if the module is on. */
  diagnosticsPath?: string;
  onDiagnosticsRecreated?: (movedTo: string, reason: string) => void;
}

export function createServerModules(ctx: ServerContext) {
  const authn = new Authenticator(createSessionRepository(ctx.db), ctx.now);
  const countries = ctx.countries ?? DEFAULT_COUNTRIES;
  const readSettings = (host: { registry: Parameters<typeof settingsReader>[0]['registry'] }) =>
    settingsReader({ ...ctx, registry: host.registry, countries });
  let store: ReturnType<typeof openDiagnosticsStore> | undefined;
  const diagnosticsStore = () =>
    (store ??= openDiagnosticsStore(
      ctx.diagnosticsPath ?? ':memory:',
      ctx.now,
      ctx.onDiagnosticsRecreated,
    ));
  return [
    defineModule({ ...coreModule, routes: coreRoutes(ctx, authn) }),
    defineModule({ ...devicesModule, routes: devicesRoutes({ ...ctx, authn, readSettings }) }),
    defineModule({ ...trackingModule, routes: trackingRoutes({ ...ctx, authn }) }),
    defineModule({
      ...diagnosticsModule,
      routes: diagnosticsRoutes({ ...ctx, authn, store: diagnosticsStore }),
      jobs: [{ name: 'diagnostics-store', start: () => () => store?.close() }],
    }),
  ] as const;
}
