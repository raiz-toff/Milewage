// Tax packs (18 section 7, plan 21 section 3.5). An ESTIMATE for the driver to bring to an
// accountant, never a filing. Each country computes its own lines from the resolved place; the
// screens show the lines and never name a country's own field.

import type { TaxRegime } from './dimensions';
import { resolvePlace } from './resolve';
import type { CountryModule, ResolvedPlace } from './types';

export interface TaxInput {
  year: number;
  region: string | null;
  /** Gross + tips + bonus, cents. */
  incomeCents: number;
  /** Deductible expenses without the ones a standard mileage rate already covers, cents. */
  expensesCents: number;
  /** Mileage deduction of standard-mileage vehicles, cents. */
  mileageCents: number;
  setAsideBp: number;
  salesTaxRegistered: boolean;
  /** Sales tax the driver collected, cents (typed; nothing is inferred). */
  collectedCents: number;
  /** Input tax credits on deductible expenses, cents. */
  creditCents: number;
}

/** One amount to set aside. `cents: null` means not estimated here, and `note` says why. */
export interface TaxLine {
  /** Stable name, also the export row name (`pension_contribution` → `Pension_Contribution`). */
  key: string;
  label: string;
  cents: number | null;
  note: string | null;
}

export interface TaxEstimate {
  net_income_cents: number;
  taxable_income_cents: number;
  /** They add up to `total_set_aside_cents` (null lines count as 0). */
  lines: TaxLine[];
  total_set_aside_cents: number;
  instalment_cents: number;
  sales_tax: {
    collected_cents: number;
    credits_cents: number;
    owing_cents: number;
    rate_bp: number;
  } | null;
}

export interface Deadline {
  date: string;
  kind: 'instalment' | 'balance' | 'filing';
  label: string;
}

export interface TaxPack {
  /** False until a person has compared every figure with the primary publications. */
  verified: boolean;
  /** Ends the "Unverified rates: these figures have not been checked against …" notice. */
  checkedAgainst: string;
  sources: readonly string[];
  notes: readonly string[];
  /** The income-tax regimes this pack estimates. */
  regimes: readonly TaxRegime[];
  /** The information slip a platform sends above a threshold per platform, if any. */
  slip: { name: string; thresholdCents: number } | null;
  estimate(input: TaxInput, place: ResolvedPlace): TaxEstimate;
  deadlines(year: number, place: ResolvedPlace): Deadline[];
  /** Who the tax office asks for instalments, in one sentence; shown beside the driver's choice. */
  instalmentsNote?: string;
}

/** Rounds half up, as the packs have always done. */
export const half = (n: number) => Math.floor(n + 0.5);

/** The country's estimate for the driver's region, or null when it has no tax pack. */
export function estimateTax(country: CountryModule, input: TaxInput): TaxEstimate | null {
  return country.tax?.estimate(input, resolvePlace(country, input.region)) ?? null;
}
