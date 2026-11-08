// How gig work differs between countries (plan 21 sections 2.5, 3.6 and 3.6a), as closed lists so
// screens and calculations can rely on them. A country picks the values that apply; one without
// checked data for a dimension leaves it out and offers nothing for it. Nothing reads these yet.

import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../expense-categories';
import type { CountryModule } from './types';

/** Location-based platform work (the ILO's term), by kind. */
export const WORK_KINDS = ['delivery', 'ride_hailing', 'moto_taxi', 'courier'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** How the law sees a driver: independent contractor, employee, or a simplified micro-business (MEI, monotributo). */
export const WORKER_STATUSES = ['contractor', 'employee', 'micro_business'] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export interface StatusOffer {
  status: WorkerStatus;
  /** The country's own word for it, when it has one (required for `micro_business`). */
  label?: string;
}

/** How income tax is collected: on net profit after deductions, on a share of gross, a fixed fee by gross band, or the platform's withholding is the whole tax. */
export const TAX_REGIMES = ['net_profit', 'presumptive', 'flat_fee', 'withheld_final'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** How a vehicle is deducted: a rate per distance, actual costs times business use, or not at all. */
export const MILEAGE_METHODS = ['per_distance', 'actual_costs', 'none'] as const;
export type MileageMethod = (typeof MILEAGE_METHODS)[number];

/** Who pays the driver: the app, the customer in cash, or a driver wallet that can go below zero. */
export const PAYERS = ['platform', 'cash', 'wallet'] as const;
export const PAYOUT_RHYTHMS = ['instant', 'weekly', 'monthly', 'none'] as const;

/** Money flow (plan 21 section 3.6). Empty for every country until filled from checked sources. */
export interface IncomeModel {
  payers: readonly (typeof PAYERS)[number][];
  tipsCommon: boolean;
  /** null: not known. */
  payoutsTaxInclusive: boolean | null;
  payoutRhythm: readonly (typeof PAYOUT_RHYTHMS)[number][];
  platformIssuesSlip: boolean;
}

/** What the OECD Model Rules for digital platforms (2020) report per seller. */
export const OECD_FIELDS = [
  'seller_identity',
  'tax_id',
  'financial_account',
  'consideration_by_quarter',
  'activities_by_quarter',
  'fees_commissions_taxes_by_quarter',
] as const;
export type OecdField = (typeof OECD_FIELDS)[number];

/** Relabel shared expense categories or add the country's own (plan 18 section 5.1). */
export interface ExpenseOverrides {
  relabel?: Readonly<Record<string, string>>;
  add?: readonly ExpenseCategory[];
}

/** The shared expense categories with a country's overrides applied. */
export function expenseCategoriesFor(c: CountryModule): ExpenseCategory[] {
  const o = c.expenseOverrides ?? {};
  return [
    ...EXPENSE_CATEGORIES.map((x) => ({ ...x, label: o.relabel?.[x.slug] ?? x.label })),
    ...(o.add ?? []),
  ];
}

const outside = (name: string, list: readonly string[], values: readonly string[]) => [
  ...values.filter((v) => !list.includes(v)).map((v) => `${name}: ${v} is not one of ${list}`),
  ...values.filter((v, i) => values.indexOf(v) !== i).map((v) => `${name}: ${v} listed twice`),
];

/** Problems with a country's answers to the dimensions. */
export function dimensionProblems(c: CountryModule): string[] {
  const statuses = c.statuses.map((s) => s.status);
  const methods = c.mileage.methods;
  const hasRates = Object.keys(c.mileage.rates).length > 0;
  const slugs = EXPENSE_CATEGORIES.map((x) => x.slug);
  const added = (c.expenseOverrides?.add ?? []).map((x) => x.slug);
  return [
    ...(c.work.length ? [] : ['work: at least one kind is required']),
    ...outside('work', WORK_KINDS, c.work),
    ...(statuses.length ? [] : ['statuses: at least one is required']),
    ...outside('statuses', WORKER_STATUSES, statuses),
    ...c.statuses
      .filter((s) => s.status === 'micro_business' && !s.label?.trim())
      .map(() => 'statuses: micro_business needs the country label'),
    ...outside('mileage methods', MILEAGE_METHODS, methods),
    ...(methods.includes('per_distance') === hasRates
      ? []
      : ['mileage methods: per_distance exactly when there are rates']),
    ...(methods.includes('none') && methods.length > 1
      ? ['mileage methods: none stands alone']
      : []),
    ...(c.tax ? outside('tax regimes', TAX_REGIMES, c.tax.regimes) : []),
    ...(c.tax && !c.tax.regimes.length ? ['tax regimes: at least one is required'] : []),
    ...(c.income ? outside('income payers', PAYERS, c.income.payers) : []),
    ...(c.income ? outside('payout rhythm', PAYOUT_RHYTHMS, c.income.payoutRhythm) : []),
    ...Object.keys(c.expenseOverrides?.relabel ?? {})
      .filter((s) => !slugs.includes(s))
      .map((s) => `expense overrides: no category ${s} to relabel`),
    ...added
      .filter((s, i) => slugs.includes(s) || added.indexOf(s) !== i)
      .map((s) => `expense overrides: ${s} already exists`),
  ];
}
