// The pack shape from before plan 21, kept as thin aliases over the country modules so consumers
// do not change yet. J4 moves the consumers to the modules and deletes this file.

import { caCountry } from './ca';
import { gbCountry } from './gb';
import { mileageDeduction, periodStart } from './mileage';
import type { CountryModule, DeductionInput } from './types';
import { usCountry } from './us';

export interface CountryPack {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  unit: 'km' | 'mi';
  /** First day of the rate period that contains `date` (tiers restart there). */
  periodStart(date: string): string;
  /** Subdivision codes (without the country) a driver may set as the region. */
  regions: readonly string[];
  /** Cents, or null when the pack has no published rate for that date or vehicle. */
  deduction(input: DeductionInput): number | null;
  sources: readonly string[];
  verified: boolean;
  notes: readonly string[];
}

export const toCountryPack = (c: CountryModule): CountryPack => ({
  code: c.code,
  unit: c.unit,
  periodStart: (date) => periodStart(c.mileage, date),
  regions: c.places.filter((p) => p.parent === c.code).map((p) => p.code.slice(c.code.length + 1)),
  deduction: (i) => mileageDeduction(c, i),
  sources: c.sources,
  verified: c.verified,
  notes: c.notes,
});

export const caPack = toCountryPack(caCountry);
export const usPack = toCountryPack(usCountry);
export const gbPack = toCountryPack(gbCountry);

export interface CountryRegistry {
  register(pack: CountryPack): void;
  get(code: string): CountryPack | undefined;
  codes(): string[];
}

export function createCountryRegistry(
  packs: readonly CountryPack[] = [caPack, usPack, gbPack],
): CountryRegistry {
  const byCode = new Map(packs.map((p) => [p.code, p]));
  return {
    register: (pack) => void byCode.set(pack.code.toUpperCase(), pack),
    get: (code) => byCode.get(code.toUpperCase()),
    codes: () => [...byCode.keys()],
  };
}

/** The pack registry of this process (alias until J4). */
export const countryPacks = createCountryRegistry();
