import type { FastifyInstance } from 'fastify';
import type { ModuleRegistry } from '@milewage/shared';
import { countryModules, resolvePlace, WORK_KINDS } from '@milewage/shared';
import { algorithmVersion } from '@milewage/track-engine';
import {
  createOwnRateRepository,
  createSettingsRepository,
  createVehicleRepository,
  type Db,
  type SettingsRow,
} from '../db';
import {
  offeredWorkKinds as offered,
  type DriverContext,
  type DriverContexts,
} from '../driver-context';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import { str, strictObject, type AuthFn } from './util';

/** The dashboard's "Finish setting up" steps; a listed step stays done (finished or skipped). */
export const SETUP_STEPS = ['vehicle', 'phone', 'backup'] as const;

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
  /** The driver's stop detection (`DriverContext.stopsOn`). */
  stopsOn: boolean,
  countries: readonly string[],
  backupDownload = false,
  exporters: string[] = [],
) {
  // Every module the owner can switch off; core and backup always run, so they have no flag.
  const fixed = new Set(reg.enabled.filter((m) => m.toggleable === false).map((m) => m.name));
  const flags = Object.entries(reg.flags()).filter(([name]) => !fixed.has(name));
  return {
    ...Object.fromEntries(flags),
    stops: stopsOn,
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
    help_enabled: { type: 'boolean' },
    diagnostics_level: { enum: ['off', 'basic', 'verbose'] },
    display_name: { type: ['string', 'null'], maxLength: 64 },
    region: { type: ['string', 'null'], minLength: 2, maxLength: 3 },
    week_start: { enum: [0, 1] },
    time_format: { enum: ['12h', '24h'] },
    default_vehicle_id: { type: ['integer', 'null'], minimum: 1 },
    own_mileage_rate: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['cents_per_unit', 'unit'],
      properties: {
        cents_per_unit: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
        unit: { enum: ['km', 'mi'] },
      },
    },
    use_own_mileage_rate: { type: 'boolean' },
    work_kinds: { type: 'array', items: { enum: [...WORK_KINDS] }, uniqueItems: true },
    onboarded: { type: 'boolean' },
    setup_done: { type: 'array', items: { enum: [...SETUP_STEPS] }, uniqueItems: true },
  },
  [],
  { minProperties: 1 },
);
type Patch = Partial<Record<string, string | number | boolean | object | null>>;

type ReaderContext = {
  drivers: DriverContexts;
  now: () => number;
  registry: ModuleRegistry;
  countries: readonly string[];
  /** `backup.download`; false until the backup module says otherwise. */
  backupDownload?: boolean;
  /** Export formats that exist right now (registered, switched on, requirements met). */
  exportFormats?: (reg: ModuleRegistry) => string[];
};

/** The odometer note of the driver's place (plan 21 `logbook` slot), or null. */
function logbookOf(d: DriverContext) {
  const l = d.pack && resolvePlace(d.pack, d.region).data.logbook;
  return l ? { readings: l.readings, notes: [...l.notes] } : null;
}

/** The `Settings` response for a user. Also returned to a phone when it pairs. */
export function settingsReader(ctx: ReaderContext) {
  return (userId: number) => {
    const d = ctx.drivers.of(userId);
    const row = d.settings;
    const verbose = row.diagnosticsLevel === 'verbose';
    const expired = verbose && (row.diagnosticsVerboseUntil ?? 0) <= ctx.now();
    const own = d.ownRate;
    return {
      modules: moduleFlags(
        ctx.registry,
        d.stopsOn,
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
      help_enabled: row.helpEnabled === 1,
      display_name: row.displayName,
      region: row.region,
      logbook: logbookOf(d),
      // Your rate in force today; the dated list is `GET /own-mileage-rates` (ADR 0007).
      own_mileage_rate: own && { cents_per_unit: own.centsPerUnit, unit: own.unit },
      mileage_rate: d.rateSource,
      use_own_mileage_rate: d.ownRates.use,
      week_start: row.weekStart,
      time_format: row.timeFormat,
      default_vehicle_id: row.defaultVehicleId,
      work_kinds: d.workKinds,
      onboarded_at: row.onboardedAt,
      setup_done: row.setupDone ?? [],
      diagnostics: {
        level: expired ? 'basic' : row.diagnosticsLevel,
        verbose_until: verbose && !expired ? row.diagnosticsVerboseUntil : null,
      },
    };
  };
}

export function settingsRoutes(
  app: FastifyInstance,
  ctx: ReaderContext & { db: Db; auth: AuthFn; emit?: EventEmit },
) {
  const repo = createSettingsRepository(ctx.db);
  const read = settingsReader(ctx);

  app.get('/settings', async (req) => {
    const { userId } = ctx.auth(req, 'SD');
    return read(userId);
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
      const c = countryModules.get(country);
      const known = c?.places
        .filter((p) => p.parent === c.code)
        .map((p) => p.code.slice(c.code.length + 1));
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
    if (b.use_own_mileage_rate !== undefined) patch.useOwnRate = b.use_own_mileage_rate ? 1 : 0;
    if (b.work_kinds !== undefined || b.country) {
      // Kinds the (new) country does not offer: refused when sent, dropped on a country change.
      const sent = b.work_kinds as string[] | undefined;
      const wrong = sent?.filter((k) => !offered(country).includes(k)) ?? [];
      if (wrong.length) {
        throw new ProblemError('validation_failed', 'Settings are not valid.', [
          {
            path: '/work_kinds',
            message: `must be among ${offered(country).join(', ') || 'none'}`,
          },
        ]);
      }
      const kept = (sent ?? prefs?.workKinds ?? []).filter((k) => offered(country).includes(k));
      patch.workKinds = kept.length ? kept : null;
    }
    if (b.onboarded !== undefined) {
      // Finishing keeps the first time; "Run setup again" clears it so the wizard opens.
      patch.onboardedAt = b.onboarded ? (prefs?.onboardedAt ?? now) : null;
      // Running setup again starts the dashboard checklist over too.
      if (!b.onboarded) patch.setupDone = null;
    }
    if (b.setup_done !== undefined) {
      // Added to what is stored, never taken away: two tabs cannot undo each other's steps.
      const stored = b.onboarded === false ? [] : (prefs?.setupDone ?? []);
      const added = (b.setup_done as string[]).filter((s) => !stored.includes(s));
      patch.setupDone = [...stored, ...added];
    }
    if (b.country) patch.country = b.country.toUpperCase();
    if (b.currency) patch.currency = b.currency.toUpperCase();
    if (b.timezone) patch.timezone = b.timezone;
    if (b.distance_unit) patch.distanceUnit = b.distance_unit as 'km' | 'mi';
    if (b.raw_retention_days) patch.rawRetentionDays = Number(b.raw_retention_days);
    if (b.stops_enabled !== undefined) patch.stopsEnabled = b.stops_enabled ? 1 : 0;
    if (b.help_enabled !== undefined) patch.helpEnabled = b.help_enabled ? 1 : 0;
    if (b.diagnostics_level) {
      patch.diagnosticsLevel = b.diagnostics_level as SettingsRow['diagnosticsLevel'];
      patch.diagnosticsVerboseUntil = b.diagnostics_level === 'verbose' ? now + VERBOSE_MS : null;
    }
    if (b.own_mileage_rate !== undefined) {
      // Before rates had dates (ADR 0007): this sets or clears the undated rate, "from the start".
      const r = b.own_mileage_rate as { cents_per_unit: number; unit: 'km' | 'mi' } | null;
      const own = createOwnRateRepository(ctx.db);
      const undated = own.onDay(userId, null);
      if (!r) {
        if (undated) own.delete(userId, undated.id);
      } else {
        // Hundredths of a cent: 0.305 €/km is entered as 30.5 cents and kept exactly.
        const row = {
          effectiveFrom: null,
          hundredths: Math.max(1, Math.round(r.cents_per_unit * 100)),
          unit: r.unit,
          note: undated?.note ?? null,
        };
        if (undated) own.update(userId, undated.id, row, now);
        else own.create(userId, row, now);
      }
    }
    repo.update(userId, patch);
    ctx.emit?.('settings.updated', { userId: String(userId) });
    return read(userId);
  });
}
