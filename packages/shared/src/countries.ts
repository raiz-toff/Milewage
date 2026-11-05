// Country packs (08 section 16.3, 07 section 3): the rates a deduction value is computed from.
// The deduction is NEVER stored; it is computed at read time from total_m and the pack for the shift's date.
// Nothing here is a compliance claim: a rate is a published figure, not advice (17 R9).

export type VehicleKind = 'car' | 'motorcycle' | 'van' | 'bicycle';

export interface DeductionInput {
  /** Business metres of the trip, shift or period slice being valued. */
  totalM: number;
  /** Business metres already driven in the same rate period (calendar year, tax year) before this slice. */
  priorM: number;
  /** Local date `YYYY-MM-DD` of the shift. */
  date: string;
  vehicleKind: VehicleKind;
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  unit: 'km' | 'mi';
  /** First day of the rate period that contains `date` (tiers restart there). */
  periodStart(date: string): string;
  /** Cents, or null when the pack has no published rate for that date or vehicle. */
  deduction(input: DeductionInput): number | null;
  /** Where the figures come from, and what has not been checked by a person. */
  sources: readonly string[];
  /** False until a person has compared every figure with the primary page (17 section 4). */
  verified: boolean;
  notes: readonly string[];
}

const KM = 1000;
const MILE = 1609.344;

/** `hi` cents per unit up to `thresholdM` driven in the period, `lo` after; rounded once. */
function tiered(i: DeductionInput, unitM: number, thresholdM: number, hi: number, lo: number) {
  const hiM = Math.max(0, Math.min(i.totalM, thresholdM - i.priorM));
  return Math.round(((hiM * hi + (i.totalM - hiM) * lo) / unitM) * 100) / 100;
}
const whole = (cents: number) => Math.round(cents);

const year = (date: string) => date.slice(0, 4);

/** Canada: prescribed per-km allowance rates (provinces), 5,000 km tier per calendar year. */
const CA_RATES: Record<string, [number, number]> = {
  '2024': [70, 64],
  '2025': [72, 66],
  '2026': [73, 67],
};
export const caPack: CountryPack = {
  code: 'CA',
  unit: 'km',
  periodStart: (d) => `${year(d)}-01-01`,
  deduction(i) {
    const r = CA_RATES[year(i.date)];
    return r && i.vehicleKind !== 'bicycle' ? whole(tiered(i, KM, 5000 * KM, r[0], r[1])) : null;
  },
  sources: [
    'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/benefits-allowances/automobile/automobile-motor-vehicle-allowances.html',
  ],
  verified: false,
  notes: [
    'Provincial rates; the territories have a higher rate that is not used.',
    'Rates fetched from the CRA page on 2026-11-05 and not yet compared by a person.',
    'The allowance rate is not the same thing as a motor vehicle expense deduction; no claim is made about which method applies.',
  ],
};

/** United States: standard mileage rate for business use, flat, with dated eras (one mid-year change in 2026). */
const US_ERAS: { from: string; centsPerMile: number }[] = [
  { from: '2024-01-01', centsPerMile: 67 },
  { from: '2025-01-01', centsPerMile: 70 },
  { from: '2026-01-01', centsPerMile: 72.5 },
  { from: '2026-07-01', centsPerMile: 76 },
];
export const usPack: CountryPack = {
  code: 'US',
  unit: 'mi',
  periodStart: (d) => `${year(d)}-01-01`,
  deduction(i) {
    if (i.vehicleKind === 'bicycle') return null;
    const era = [...US_ERAS].reverse().find((e) => e.from <= i.date);
    return era ? whole((i.totalM / MILE) * era.centsPerMile) : null;
  },
  sources: ['https://www.irs.gov/tax-professionals/standard-mileage-rates'],
  verified: false,
  notes: [
    'Rates fetched from the IRS page on 2026-11-05 and not yet compared by a person.',
    'The 2026 rate changed on 1 July; a shift uses the rate of its local date.',
  ],
};

/** United Kingdom: simplified expenses flat rates; the tax year starts on 6 April. */
export const gbPack: CountryPack = {
  code: 'GB',
  unit: 'mi',
  periodStart: (d) =>
    d >= `${year(d)}-04-06` ? `${year(d)}-04-06` : `${Number(year(d)) - 1}-04-06`,
  deduction(i) {
    if (i.vehicleKind === 'bicycle') return null;
    if (i.vehicleKind === 'motorcycle') return whole((i.totalM / MILE) * 24);
    const first = i.date >= '2026-04-06' ? 55 : 45;
    return whole(tiered(i, MILE, 10_000 * MILE, first, 25));
  },
  sources: ['https://www.gov.uk/simpler-income-tax-simplified-expenses/vehicles'],
  verified: false,
  notes: [
    'UNVERIFIED: HMRC required log fields and rates stay unverified until a person checks them (17 M9.2).',
    'Fetched 2026-11-05: cars and goods vehicles 55p to 10,000 miles then 25p from 6 April 2026 (45p before), motorcycles 24p. Only the 2026-27 page was read, so earlier years are the 45p/25p of that statement, not independently seen.',
    'Bicycles: no rate is registered, so no deduction.',
  ],
};

export interface CountryRegistry {
  register(pack: CountryPack): void;
  get(code: string): CountryPack | undefined;
  codes(): string[];
}

/** The registry a new country attaches to without editing anything else (08 section 16.3). */
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

/** The registry of this process; a new country calls `countryPacks.register(pack)` and nothing else changes. */
export const countryPacks = createCountryRegistry();
