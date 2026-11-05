import { defineModule } from '@milewage/shared';
import { algorithmVersion } from '@milewage/track-engine';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp, createServerModules } from '../src/index';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const get = (url: string) => h.call('GET', url, undefined, { cookie });
const patch = (payload: object) => h.call('PATCH', '/settings', payload, { cookie });

test('GET /settings returns the preferences, engine version and diagnostics', async () => {
  expect((await get('/settings')).json()).toMatchObject({
    ...{ country: 'US', distance_unit: 'mi', currency: 'USD', raw_retention_days: 90 },
    engine_version: algorithmVersion,
    diagnostics: { level: 'basic', verbose_until: null, capture: null },
  });
  expect((await h.call('GET', '/settings')).json().code).toBe('auth_required');
});

test('the modules object follows the registry: registered is true, absent is false', async () => {
  const flagsOf = async (capture: boolean) => {
    const modules = [
      ...createServerModules({ db: h.db, now: () => h.clock.t }),
      defineModule({ name: 'capture', dependsOn: ['core'] }),
    ];
    const app = buildApp({ modules, enabled: { core: true, capture }, logLevel: 'silent' });
    const res = await app.fastify.inject({ url: '/api/v1/settings', headers: { cookie } });
    await app.fastify.close();
    return res.json().modules;
  };
  expect((await flagsOf(true)).capture).toBe(true);
  expect(await flagsOf(false)).toMatchObject({
    capture: false,
    live: true,
    tracking: true,
    stops: true,
    backup_download: true,
    exporters: ['csv', 'gpx', 'geojson'],
    countries: ['US', 'CA', 'GB'],
  });
});

test('PATCH /settings validates and stores; unknown fields and empty bodies are 422', async () => {
  const ok = await patch({
    country: 'ca',
    currency: 'cad',
    raw_retention_days: 30,
    stops_enabled: false,
  });
  expect(ok.json()).toMatchObject({ country: 'CA', currency: 'CAD', raw_retention_days: 30 });
  expect((await get('/settings')).json().stops_enabled).toBe(false);

  const bad = [{ country: 'FR' }, { timezone: 'Mars/Olympus' }, { currency: '123' }];
  for (const p of [...bad, { raw_retention_days: 6 }, { colour: 'red' }, {}]) {
    expect((await patch(p)).statusCode).toBe(422);
  }
  expect((await get('/settings')).json().country).toBe('CA');
});

test('verbose diagnostics revert to basic after 7 days', async () => {
  const verbose = (await patch({ diagnostics_level: 'verbose' })).json();
  expect(verbose.diagnostics.verbose_until).toBe(h.clock.t + 7 * 86_400_000);
  h.clock.t += 7 * 86_400_000;
  expect((await get('/settings')).json().diagnostics.level).toBe('basic');
});
