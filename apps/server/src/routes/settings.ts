import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@milewage/shared';
import { countryPacks } from '@milewage/shared';
import { algorithmVersion } from '@milewage/track-engine';
import {
  createSettingsRepository,
  createVehicleRepository,
  type Db,
  type SettingsRow,
} from '../db';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { str, strictObject, type AuthFn } from './util';

/** Registered country packs until the pack registry exists (08 section 16.3). */
export const DEFAULT_COUNTRIES = ['US', 'CA', 'GB'] as const;
/** Driver admin modules (18): each is a flag in `modules` so the web can hide its screen. */
export const COMMA_MODULES = [
  'platforms',
  'earnings',
  'expenses',
  'receipts',
  'tax',
  'goals',
  'analytics',
  'maintenance',
  'import',
  'notifications',
  'schedule',
];
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
  backupDownload = false,
  exporters: string[] = [],
) {
  const on = (name: string) => reg.isEnabled(name);
  const flag = (names: string[]) => Object.fromEntries(names.map((n) => [n, on(n)]));
  return {
    ...flag(['sync', 'devices', 'tracking', 'replay', 'live', 'diagnostics', 'capture']),
    ...flag(COMMA_MODULES),
    stops: on('stops') && stopsEnabled,
    // The engine is always on; this flag is the `backup.download` toggle and its routes.
    backup_download: backupDownload,
    exporters,
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
    display_name: { type: ['string', 'null'], maxLength: 64 },
    region: { type: ['string', 'null'], minLength: 2, maxLength: 3 },
    week_start: { enum: [0, 1] },
    time_format: { enum: ['12h', '24h'] },
    default_vehicle_id: { type: ['integer', 'null'], minimum: 1 },
  },
  [],
  { minProperties: 1 },
);
type Patch = Partial<Record<string, string | number | boolean | null>>;

type ReaderContext = {
  db: Db;
  now: () => number;
  registry: ModuleRegistry;
  countries: readonly string[];
  /** `backup.download`; false until the backup module says otherwise. */
  backupDownload?: boolean;
  /** Export formats that exist right now (registered, switched on, requirements met). */
  exportFormats?: (reg: ModuleRegistry) => string[];
  /** The active capture session of a device, for `diagnostics.capture` (module `capture`). */
  captureFor?: (userId: number, deviceId: number) => object | null;
};

/** The `Settings` response for a user. Also returned to a phone when it pairs. */
export function settingsReader(ctx: ReaderContext) {
  const repo = createSettingsRepository(ctx.db);
  return (userId: number, deviceId?: number) => {
    const row = repo.get(userId);
    if (!row) throw new ProblemError('not_found', 'No settings for this user.');
    const verbose = row.diagnosticsLevel === 'verbose';
    const expired = verbose && (row.diagnosticsVerboseUntil ?? 0) <= ctx.now();
    return {
      modules: moduleFlags(
        ctx.registry,
        row.stopsEnabled === 1,
        ctx.countries,
        ctx.backupDownload,
        ctx.exportFormats?.(ctx.registry),
      ),
      engine_version: algorithmVersion,
      country: row.country,
      distance_unit: row.distanceUnit,
      currency: row.currency,
      timezone: row.timezone,
      raw_retention_days: row.rawRetentionDays,
      stops_enabled: row.stopsEnabled === 1,
      display_name: row.displayName,
      region: row.region,
      week_start: row.weekStart,
      time_format: row.timeFormat,
      default_vehicle_id: row.defaultVehicleId,
      diagnostics: {
        level: expired ? 'basic' : row.diagnosticsLevel,
        verbose_until: verbose && !expired ? row.diagnosticsVerboseUntil : null,
        capture: deviceId === undefined ? null : (ctx.captureFor?.(userId, deviceId) ?? null),
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

  app.get('/settings', async (req) => {
    const p = ctx.auth(req, 'SD');
    return read(p.userId, p.kind === 'device' ? p.deviceId : undefined);
  });

  app.patch('/settings', { schema: { body: patchSchema } }, async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const b = req.body as Patch & {
      country?: string;
      currency?: string;
      timezone?: string;
      display_name?: string | null;
      region?: string | null;
    };
    checkPrefs(b, ctx.countries);
    const now = ctx.now();
    const patch: Partial<SettingsRow> = { updatedAt: now };
    const prefs = repo.get(userId);
    const country = (b.country ?? prefs?.country ?? '').toUpperCase();
    const region = b.region === undefined ? prefs?.region : b.region;
    if (b.display_name !== undefined) patch.displayName = b.display_name?.trim() || null;
    if (b.week_start !== undefined) patch.weekStart = Number(b.week_start);
    if (b.time_format) patch.timeFormat = b.time_format as '12h' | '24h';
    if (b.region !== undefined || b.country) {
      // A region belongs to its country: a new country clears a region it does not have.
      const known = countryPacks.get(country)?.regions;
      const ok = region == null || (known?.includes(region.toUpperCase()) ?? false);
      if (!ok && b.region != null) {
        throw new ProblemError('validation_failed', 'Settings are not valid.', [
          {
            path: '/region',
            message: `must be one of ${known?.join(', ') ?? 'none for this country'}`,
          },
        ]);
      }
      patch.region = ok && region ? region.toUpperCase() : null;
    }
    if (b.default_vehicle_id !== undefined) {
      const v =
        b.default_vehicle_id === null
          ? undefined
          : createVehicleRepository(ctx.db).find(userId, Number(b.default_vehicle_id));
      if (b.default_vehicle_id !== null && (!v || v.archivedAt !== null)) {
        throw new ProblemError('validation_failed', 'Settings are not valid.', [
          { path: '/default_vehicle_id', message: 'must be one of your active vehicles' },
        ]);
      }
      patch.defaultVehicleId = b.default_vehicle_id === null ? null : Number(b.default_vehicle_id);
    }
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
