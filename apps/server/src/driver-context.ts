import {
  countryModules,
  ownRateAt,
  rateSourceAt,
  type CountryModule,
  type OwnRate,
  type OwnRates,
} from '@milewage/shared';
import {
  createBackupRepository,
  createOwnRateRepository,
  createSettingsRepository,
  type Db,
  type SettingsRow,
} from './db';
import { ProblemError } from './errors';
import { localDate, localInstant } from './time';

/**
 * The owner's settings as the server sees them for one request or job: read once, with every rule
 * that turns the stored row into what the rest of the server needs (the clock, the place, the rates,
 * the switches). Nothing else reads the settings row; `PATCH /settings` and the vehicle archive
 * clean-up write it.
 */
export interface DriverContext {
  readonly userId: number;
  /** The row as stored, for the few fields only one screen shows (display name, diagnostics, offsite copy). */
  readonly settings: SettingsRow;
  /** The owner's IANA time zone; every local date and local time is in it. */
  readonly timeZone: string;
  /** The first day of the week: 0 Sunday, 1 Monday. */
  readonly weekStart: number;
  readonly unit: 'km' | 'mi';
  /** ISO 4217, upper case. */
  readonly currency: string;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  /** The region code inside the country, or null (national rules, owner decision Q4). */
  readonly region: string | null;
  /** The country pack, or undefined for a country MileWage has none for. */
  readonly pack: CountryModule | undefined;
  /** Your mileage rate in force today (owner decision Q5, ADR 0007), or null. */
  readonly ownRate: OwnRate | null;
  /** Every one of your mileage rates with its date, and whether they replace the country's (ADR 0007). */
  readonly ownRates: OwnRates;
  /**
   * What values mileage driven today: the pack's official rates, your mileage rate (chosen, or
   * where the country has none), or nothing. Older shifts may differ: `rateSourceAt` decides by date.
   */
  readonly rateSource: 'official' | 'yours' | 'none';
  /** The driver's work kinds: the chosen ones the country offers, or its only one when none is chosen. */
  readonly workKinds: string[];
  /**
   * Stop detection for this driver now (decision 1.5b): the `stops` module is on and the driver's
   * setting is on. New shifts get the stop segmenter, labels can be read and written, labelled fares
   * count as earnings. A shift already recorded keeps the segmenter it started with.
   */
  readonly stopsOn: boolean;
  /** The owner's local date now. */
  today(): string;
  /** The owner's local date of an instant. */
  dateOf(at: number): string;
  /** The instant of a local date and minute of the day (DST rules in `localInstant`). */
  instantOf(date: string, minutes: number): number;
}

export interface DriverContexts {
  /** The context of a signed-in user. A user without settings has not finished setup: `setup_incomplete`. */
  of(userId: number): DriverContext;
  /** The same, or undefined when the user has no settings (a job or a listener with only an id). */
  find(userId: number): DriverContext | undefined;
  /** The owner's context; undefined before setup. */
  owner(): DriverContext | undefined;
}

/** Work kinds a country offers (plan 21 section 3.6a); none for an unknown country. */
export const offeredWorkKinds = (country: string): readonly string[] =>
  countryModules.get(country)?.work ?? [];

/** Plan 23 rule 1: a question with one answer is not asked. */
function workKindsOf(country: string, chosen: readonly string[] | null): string[] {
  const kinds = offeredWorkKinds(country);
  const mine = (chosen ?? []).filter((k) => kinds.includes(k));
  return mine.length || kinds.length !== 1 ? mine : [...kinds];
}

function contextOf(
  row: SettingsRow,
  rates: OwnRates['rates'],
  now: () => number,
  stopsModule: boolean,
): DriverContext {
  const pack = countryModules.get(row.country);
  const timeZone = row.timezone;
  const today = localDate(now(), timeZone);
  const ownRates = { rates, use: row.useOwnRate === 1 };
  const inForce = ownRateAt(rates, today);
  const ownRate = inForce && { centsPerUnit: inForce.centsPerUnit, unit: inForce.unit };
  return {
    userId: row.userId,
    settings: row,
    timeZone,
    weekStart: row.weekStart,
    unit: row.distanceUnit,
    currency: row.currency,
    country: row.country,
    region: row.region,
    pack,
    ownRate,
    ownRates,
    rateSource: rateSourceAt(pack, ownRates, today),
    workKinds: workKindsOf(row.country, row.workKinds),
    stopsOn: stopsModule && row.stopsEnabled === 1,
    today: () => localDate(now(), timeZone),
    dateOf: (at) => localDate(at, timeZone),
    instantOf: (date, minutes) => localInstant(date, minutes, timeZone),
  };
}

/**
 * Reads the owner's settings. Each call reads the row once; a caller reads it once per request or
 * job and keeps the context for the rest of it. `stopsModule` is whether the `stops` module is on.
 */
export function createDriverContexts({
  db,
  now,
  stopsModule,
}: {
  db: Db;
  now: () => number;
  stopsModule: () => boolean;
}): DriverContexts {
  const settings = createSettingsRepository(db);
  const owners = createBackupRepository(db);
  const own = createOwnRateRepository(db);
  const find = (userId: number) => {
    const row = settings.get(userId);
    // Hundredths of a cent: 0.305 €/km is entered as 30.5 cents and kept exactly.
    const rates = () =>
      own.list(userId).map((r) => ({
        effectiveFrom: r.effectiveFrom,
        centsPerUnit: r.hundredths / 100,
        unit: r.unit,
        tier:
          r.thresholdUnits !== null && r.afterHundredths !== null
            ? { thresholdUnits: r.thresholdUnits, afterCentsPerUnit: r.afterHundredths / 100 }
            : null,
      }));
    return row && contextOf(row, rates(), now, stopsModule());
  };
  return {
    of(userId) {
      const c = find(userId);
      if (!c) throw new ProblemError('setup_incomplete', 'Finish setup first.');
      return c;
    },
    find,
    owner() {
      const id = owners.ownerId();
      return id === undefined ? undefined : find(id);
    },
  };
}
