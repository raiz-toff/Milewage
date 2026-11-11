import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { algorithmVersion } from '@milewage/track-engine';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadMigrations, MIGRATIONS_DIR, migrate, openDatabase } from '../src/index';
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
    const other = harness({ capture });
    const { cookie } = await other.signUp();
    const res = await other.call('GET', '/settings', undefined, { cookie });
    await other.close();
    return res.json().modules;
  };
  expect((await flagsOf(true)).capture).toBe(true);
  expect(await flagsOf(false)).toMatchObject({
    capture: false,
    tracking: true,
    stops: true,
    backup_download: true,
    exporters: ['csv', 'expenses', 'tax_summary', 'pdf'],
    countries: ['US', 'CA', 'GB'],
  });
});

test("logbook: the odometer note of the driver's place, null where the country has none", async () => {
  await patch({ country: 'CA', region: 'QC' });
  expect((await get('/settings')).json().logbook).toMatchObject({
    readings: expect.stringContaining('CRA asks for the odometer reading'),
    notes: [expect.stringContaining('base year')],
  });
  await patch({ country: 'US', region: null });
  expect((await get('/settings')).json().logbook).toBeNull();
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

test('help_enabled: on by default, a PATCH turns it off and it stays off; only a boolean is accepted (ADR 0002)', async () => {
  expect((await get('/settings')).json().help_enabled).toBe(true);
  const off = await patch({ help_enabled: false });
  expect(off.statusCode).toBe(200);
  expect(off.json().help_enabled).toBe(false);
  expect((await get('/settings')).json().help_enabled).toBe(false);
  // The server's validator coerces 0, 1, "true" and "false" as Fastify does for every boolean.
  for (const p of [{ help_enabled: 'no' }, { help_enabled: { on: true } }]) {
    expect((await patch(p)).statusCode).toBe(422);
  }
  expect((await get('/settings')).json().help_enabled).toBe(false);
  expect((await patch({ help_enabled: true })).json().help_enabled).toBe(true);
});

test('the help migration turns Help on for owners who already have settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-help-'));
  const db = openDatabase(join(dir, 'milewage.db'));
  try {
    const all = loadMigrations(MIGRATIONS_DIR);
    migrate(
      db,
      all.filter((m) => !(m.module === 'core' && m.id >= '0013')),
    );
    db.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
      INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at)
        VALUES (1, 'CA', 'km', 'CAD', 'UTC', 1);`);
    expect(migrate(db, all)).toContain('core/0013_help_pages');
    expect(db.prepare('SELECT help_enabled FROM settings').get()).toEqual({ help_enabled: 1 });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verbose diagnostics revert to basic after 7 days', async () => {
  const verbose = (await patch({ diagnostics_level: 'verbose' })).json();
  expect(verbose.diagnostics.verbose_until).toBe(h.clock.t + 7 * 86_400_000);
  h.clock.t += 7 * 86_400_000;
  expect((await get('/settings')).json().diagnostics.level).toBe('basic');
});
