import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@milewage/shared';
import { algorithmVersion } from '@milewage/track-engine';
import { createSettingsRepository, type Db, type SettingsRow } from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { str, strictObject, type AuthFn } from './util';

/** Registered country packs until the pack registry exists (08 section 16.3). */
export const DEFAULT_COUNTRIES = ['US', 'CA', 'GB'] as const;
const VERBOSE_MS = 7 * 24 * 60 * 60 * 1000;

const validZone = (tz: string) => {
  try {
    return !!new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    return false;
  }
};

/** Semantic checks for PATCH /settings; the JSON schema covers the shapes. */
export function checkPrefs(
  p: { country?: string; currency?: string; timezone?: string },
  countries: readonly string[],
): void {
  const checks: [string, string | undefined, boolean, string][] = [
    [
      '/country',
      p.country,
      countries.includes(p.country?.toUpperCase() ?? ''),
      `one of ${countries}`,
    ],
    ['/currency', p.currency, /^[A-Za-z]{3}$/.test(p.currency ?? ''), 'three letters (ISO 4217)'],
    ['/timezone', p.timezone, validZone(p.timezone ?? ''), 'an IANA time zone name'],
  ];
  const errors = checks
    .filter(([, value, ok]) => value !== undefined && !ok)
    .map(([path, , , want]) => ({ path, message: `must be ${want}` }));
  if (errors.length) throw new ProblemError('validation_failed', 'Settings are not valid.', errors);
}

/** The read-only `modules` object: what this server runs, derived from the registry (08 section 16.1). */
export function moduleFlags(
  reg: ModuleRegistry,
  stopsEnabled: boolean,
  countries: readonly string[],
) {
  const on = (name: string) => reg.isEnabled(name);
  const flag = (names: string[]) => Object.fromEntries(names.map((n) => [n, on(n)]));
  return {
    ...flag(['sync', 'devices', 'tracking', 'replay', 'live', 'diagnostics', 'capture']),
    stops: on('stops') && stopsEnabled,
    // The engine is always on; this flag is the `backup.download` toggle and its route (M3.2).
    backup_download: false,
    exporters: ['csv', 'pdf', 'gpx', 'geojson'].filter((f) => on(`export_${f}`)),
    countries: [...countries],
  };
}

const patchSchema = strictObject(
  {
    country: str(2, 2),
    distance_unit: { enum: ['km', 'mi'] },
    currency: str(3, 3),
    timezone: str(1, 64),
    raw_retention_days: { type: 'integer', minimum: 7 },
    stops_enabled: { type: 'boolean' },
    diagnostics_level: { enum: ['off', 'basic', 'verbose'] },
  },
  [],
  { minProperties: 1 },
);
type Patch = Partial<Record<string, string | number | boolean>>;

type ReaderContext = {
  db: Db;
  now: () => number;
  registry: ModuleRegistry;
  countries: readonly string[];
};

/** The `Settings` response for a user. Also returned to a phone when it pairs. */
export function settingsReader(ctx: ReaderContext) {
  const repo = createSettingsRepository(ctx.db);
  return (userId: number) => {
    const row = repo.get(userId);
    if (!row) throw new ProblemError('not_found', 'No settings for this user.');
    const verbose = row.diagnosticsLevel === 'verbose';
    const expired = verbose && (row.diagnosticsVerboseUntil ?? 0) <= ctx.now();
    return {
      modules: moduleFlags(ctx.registry, row.stopsEnabled === 1, ctx.countries),
      engine_version: algorithmVersion,
      country: row.country,
      distance_unit: row.distanceUnit,
      currency: row.currency,
      timezone: row.timezone,
      raw_retention_days: row.rawRetentionDays,
      stops_enabled: row.stopsEnabled === 1,
      diagnostics: {
        level: expired ? 'basic' : row.diagnosticsLevel,
        verbose_until: verbose && !expired ? row.diagnosticsVerboseUntil : null,
        capture: null,
      },
    };
  };
}

export function settingsRoutes(
  app: FastifyInstance,
  ctx: ReaderContext & { auth: AuthFn; emit?: EventEmit },
) {
  const repo = createSettingsRepository(ctx.db);
  const read = settingsReader(ctx);

  app.get('/settings', async (req) => read(ctx.auth(req, 'SD').userId));

  app.patch('/settings', { schema: { body: patchSchema } }, async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const b = req.body as Patch & { country?: string; currency?: string; timezone?: string };
    checkPrefs(b, ctx.countries);
    const now = ctx.now();
    const patch: Partial<SettingsRow> = { updatedAt: now };
    if (b.country) patch.country = b.country.toUpperCase();
    if (b.currency) patch.currency = b.currency.toUpperCase();
    if (b.timezone) patch.timezone = b.timezone;
    if (b.distance_unit) patch.distanceUnit = b.distance_unit as 'km' | 'mi';
    if (b.raw_retention_days) patch.rawRetentionDays = Number(b.raw_retention_days);
    if (b.stops_enabled !== undefined) patch.stopsEnabled = b.stops_enabled ? 1 : 0;
    if (b.diagnostics_level) {
      patch.diagnosticsLevel = b.diagnostics_level as SettingsRow['diagnosticsLevel'];
      patch.diagnosticsVerboseUntil = b.diagnostics_level === 'verbose' ? now + VERBOSE_MS : null;
    }
    repo.update(userId, patch);
    ctx.emit?.('settings.updated', { userId: String(userId) });
    return read(userId);
  });
}
