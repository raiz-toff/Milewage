// Mileage deduction from a country's dated rates (07 section 3). The value is never stored; it is
// computed at read time from the distance and the rate of the shift's local date.

import { valueAt } from './dated';
import type { MileageMethod } from './dimensions';
import {
  notAutomobile,
  type CountryModule,
  type Dated,
  type DeductionInput,
  type Place,
  type VehicleKind,
} from './types';

/** One mileage rate for a vehicle class. Tiers restart at the start of each rate period. */
export type MileageRate =
  | { kind: 'flat'; perUnit: Dated<number> }
  | { kind: 'tiered'; thresholdUnits: number; first: Dated<number>; after: Dated<number> };

export interface Mileage {
  /** `MM-DD` the rate period starts on each year (calendar year `01-01`, UK tax year `04-06`). */
  yearStarts: string;
  /** How a vehicle may be deducted; `per_distance` exactly when there are rates. */
  methods: readonly MileageMethod[];
  /** Rates by vehicle class; a class without a rate gets no deduction. */
  rates: Partial<Record<VehicleKind, MileageRate>>;
}

export const UNIT_METRES = { km: 1000, mi: 1609.344 } as const;

/** First day of the rate period that contains `date`. */
export function periodStart(m: Mileage, date: string): string {
  const start = `${date.slice(0, 4)}-${m.yearStarts}`;
  return date >= start ? start : `${Number(date.slice(0, 4)) - 1}-${m.yearStarts}`;
}

/** Cents, or null when there is no published rate for that date or vehicle. */
export function mileageDeduction(c: CountryModule, i: DeductionInput): number | null {
  const rate = c.mileage.rates[i.vehicleKind];
  const unitM = UNIT_METRES[c.unit];
  if (!rate) return null;
  if (rate.kind === 'flat') {
    const r = valueAt(rate.perUnit, i.date);
    return r === null ? null : Math.round((i.totalM / unitM) * r);
  }
  const first = valueAt(rate.first, i.date);
  const after = valueAt(rate.after, i.date);
  if (first === null || after === null) return null;
  const firstM = Math.max(0, Math.min(i.totalM, rate.thresholdUnits * unitM - i.priorM));
  // Rounded twice, as before plan 21 (section 8): to 1/100 cent, then to a whole cent.
  const hundredths = Math.round(((firstM * first + (i.totalM - firstM) * after) / unitM) * 100);
  return Math.round(hundredths / 100);
}

/** The driver's own rate (owner decision Q5): cents, with hundredths, per km or mile. */
export interface OwnRate {
  centsPerUnit: number;
  unit: 'km' | 'mi';
}

/**
 * Which rate values the driver's mileage: the country's published rates, the driver's own rate
 * (only where the country has none; it never replaces an official rate), or none.
 */
export function mileageRateSource(c: CountryModule | undefined, own: OwnRate | null) {
  if (c && Object.keys(c.mileage.rates).length > 0) return 'official' as const;
  return own ? ('yours' as const) : ('none' as const);
}

/** Cents at the driver's own rate; like an official rate, none for a non-automobile. */
export function ownRateDeduction(r: OwnRate, i: Pick<DeductionInput, 'totalM' | 'vehicleKind'>) {
  return notAutomobile(i.vehicleKind)
    ? null
    : Math.round((i.totalM / UNIT_METRES[r.unit]) * r.centsPerUnit);
}

/** Regions from `{ ON: 'Ontario' }`, with any data, sources or notes by region code. */
export function regionsOf(
  country: string,
  names: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, Omit<Place, 'code' | 'parent' | 'name'>>> = {},
): Place[] {
  return Object.entries(names).map(([code, name]) => ({
    code: `${country}-${code}`,
    parent: country,
    name,
    ...extra[code],
  }));
}
