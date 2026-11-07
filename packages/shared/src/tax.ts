// Tax packs (18 section 7). An ESTIMATE for the driver to bring to an accountant, never a filing.
// Every figure is data with a year; a pack whose figures a person has not compared with the
// primary page says so (`verified: false`) and the screens show an "unverified rates" notice.
// Only CA ships. US (Schedule C, self-employment tax) and GB (National Insurance) are NOT here:
// those helpers exist in Comma's code but its own docs say the numbers were removed until verified.

export interface CppYear {
  /** Year's maximum pensionable earnings, cents. */
  ympeCents: number;
  /** Year's additional maximum pensionable earnings (second ceiling), cents. */
  yampeCents: number;
  /** Basic annual exemption, cents. */
  exemptionCents: number;
  /** Self-employed contribution rate on the first band, basis points (both halves). */
  selfBp: number;
  /** Self-employed contribution rate on the second band (CPP2), basis points. */
  self2Bp: number;
}

export interface TaxPack {
  country: string;
  /** False until a person has compared every figure with the CRA publications (18 section 16 item 5). */
  verified: boolean;
  sources: readonly string[];
  notes: readonly string[];
  cpp: Readonly<Record<number, CppYear>>;
  /** Regions whose pension plan is not the CPP: the estimate leaves the contribution out and says so. */
  ownPensionPlan: readonly string[];
  /** GST or HST by region, basis points, for display next to the sales tax lines. */
  salesTaxBp: Readonly<Record<string, number>>;
  defaultSalesTaxBp: number;
  /** Reporting threshold per platform for the information slip, cents. */
  slipThresholdCents: number;
  slipName: string;
  /**
   * When platforms send the information slips for a tax year: from the start of the season to the
   * date they must be sent by. Drives the "collect your slips" notification.
   */
  slipSeason(year: number): { from: string; by: string };
  /** Deadlines of a tax year as `MM-DD` in the year (`next`: in the following year). */
  deadlines(
    year: number,
  ): { date: string; kind: 'instalment' | 'balance' | 'filing'; label: string }[];
}

export const caTaxPack: TaxPack = {
  country: 'CA',
  verified: false,
  sources: [
    'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html',
    'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-10100-employment-income/employment-income-slips/t4a.html',
  ],
  notes: [
    'UNVERIFIED: every figure was written from memory of the CRA publications and has not been compared with them by a person.',
    'CPP2 and the second ceiling exist only for 2024 onward; years not listed have no contribution estimate.',
    'Quebec (QPP) is not in the pack: the estimate leaves the pension contribution out for region QC.',
    'Income tax is the driver’s own set-aside rate, a planning figure, not tax brackets.',
  ],
  cpp: {
    2025: {
      ympeCents: 7_130_000,
      yampeCents: 8_120_000,
      exemptionCents: 350_000,
      selfBp: 1190,
      self2Bp: 800,
    },
    2026: {
      ympeCents: 7_460_000,
      yampeCents: 8_500_000,
      exemptionCents: 350_000,
      selfBp: 1190,
      self2Bp: 800,
    },
  },
  ownPensionPlan: ['QC'],
  salesTaxBp: { ON: 1300, NB: 1500, NL: 1500, NS: 1500, PE: 1500 },
  defaultSalesTaxBp: 500,
  slipThresholdCents: 50_000,
  slipName: 'T4A',
  // T4A slips must be sent by the last day of February after the tax year.
  slipSeason: (y) => {
    const leap = (y + 1) % 4 === 0 && ((y + 1) % 100 !== 0 || (y + 1) % 400 === 0);
    return { from: `${y + 1}-02-01`, by: `${y + 1}-02-${leap ? 29 : 28}` };
  },
  deadlines: (y) => [
    { date: `${y}-03-15`, kind: 'instalment', label: 'Instalment 1' },
    { date: `${y}-06-15`, kind: 'instalment', label: 'Instalment 2' },
    { date: `${y}-09-15`, kind: 'instalment', label: 'Instalment 3' },
    { date: `${y}-12-15`, kind: 'instalment', label: 'Instalment 4' },
    { date: `${y + 1}-04-30`, kind: 'balance', label: 'Balance owing' },
    { date: `${y + 1}-06-15`, kind: 'filing', label: 'Self-employed filing' },
  ],
};

export interface TaxRegistry {
  get(country: string): TaxPack | undefined;
  codes(): string[];
}

/** Packs by country; the server turns on only the ones in `comma.tax_countries` (default CA). */
export function createTaxRegistry(packs: readonly TaxPack[] = [caTaxPack]): TaxRegistry {
  const by = new Map(packs.map((p) => [p.country, p]));
  return { get: (c) => by.get(c.toUpperCase()), codes: () => [...by.keys()] };
}
export const taxPacks = createTaxRegistry();

const half = (n: number) => Math.floor(n + 0.5);

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

export interface TaxEstimate {
  net_income_cents: number;
  taxable_income_cents: number;
  cpp_cents: number | null;
  cpp2_cents: number | null;
  pension_note: string | null;
  income_tax_cents: number;
  total_set_aside_cents: number;
  instalment_cents: number;
  sales_tax: {
    collected_cents: number;
    credits_cents: number;
    owing_cents: number;
    rate_bp: number;
  } | null;
}

/** The estimate of 18 section 7.2, computed in cents. */
export function estimateTax(pack: TaxPack, i: TaxInput): TaxEstimate {
  const net = i.incomeCents - i.expensesCents - i.mileageCents;
  const taxable = Math.max(0, net);
  const cpp = pack.cpp[i.year];
  const ownPlan = i.region !== null && pack.ownPensionPlan.includes(i.region);
  let cpp1: number | null = null;
  let cpp2: number | null = null;
  let note: string | null = null;
  if (ownPlan) note = `Region ${i.region} has its own pension plan; it is not estimated here.`;
  else if (!cpp) note = `The pack has no contribution figures for ${i.year}.`;
  else {
    const first = Math.max(0, Math.min(taxable, cpp.ympeCents) - cpp.exemptionCents);
    const second = Math.max(0, Math.min(taxable, cpp.yampeCents) - cpp.ympeCents);
    cpp1 = half((first * cpp.selfBp) / 10_000);
    cpp2 = half((second * cpp.self2Bp) / 10_000);
  }
  const tax = half((taxable * i.setAsideBp) / 10_000);
  const total = tax + (cpp1 ?? 0) + (cpp2 ?? 0);
  const rate = (i.region && pack.salesTaxBp[i.region]) || pack.defaultSalesTaxBp;
  return {
    net_income_cents: net,
    taxable_income_cents: taxable,
    cpp_cents: cpp1,
    cpp2_cents: cpp2,
    pension_note: note,
    income_tax_cents: tax,
    total_set_aside_cents: total,
    instalment_cents: half(total / 4),
    sales_tax: i.salesTaxRegistered
      ? {
          collected_cents: i.collectedCents,
          credits_cents: i.creditCents,
          owing_cents: i.collectedCents - i.creditCents,
          rate_bp: rate,
        }
      : null,
  };
}
