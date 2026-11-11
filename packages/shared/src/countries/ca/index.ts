// Canada. Figures are copied unchanged from the packs that came before plan 21.

import { regionsOf, type MileageRate } from '../mileage';
import { offer } from '../slots';
import { caTax } from './tax';
import type { CountryModule, Dated } from '../types';

const CRA_ALLOWANCE =
  'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/benefits-allowances/automobile/automobile-motor-vehicle-allowances.html';
const perKm = (label: string, values: Dated<number>['values']): Dated<number> => ({
  label,
  unit: 'cents/km',
  reference: [CRA_ALLOWANCE],
  values,
});

/** Prescribed per-km allowance rates (provinces), 5,000 km tier per calendar year. */
const allowance: MileageRate = {
  kind: 'tiered',
  thresholdUnits: 5000,
  first: perKm('First 5,000 km', {
    '2024-01-01': 70,
    '2025-01-01': 72,
    '2026-01-01': 73,
    '2027-01-01': null,
  }),
  after: perKm('After 5,000 km', {
    '2024-01-01': 64,
    '2025-01-01': 66,
    '2026-01-01': 67,
    '2027-01-01': null,
  }),
};

const CRA_CPP =
  'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html';
/** CPP figures for 2025 and 2026 (years without figures get no contribution estimate). */
const cpp = (
  label: string,
  unit: string,
  y2025: number,
  y2026: number,
  y2027?: number,
): Dated<number> => ({
  label,
  unit,
  reference: [CRA_CPP],
  values: {
    '2025-01-01': y2025,
    '2026-01-01': y2026,
    ...(y2027 === undefined ? { '2027-01-01': null } : { '2027-01-01': y2027, '2028-01-01': null }),
  },
});

const hst = (rateBp: number) => ({ salesTax: [{ key: 'hst', label: 'HST', rateBp }] });

export const caCountry: CountryModule = {
  code: 'CA',
  currency: 'CAD',
  unit: 'km',
  labels: { region: 'province' },
  places: regionsOf(
    'CA',
    {
      AB: 'Alberta',
      BC: 'British Columbia',
      MB: 'Manitoba',
      NB: 'New Brunswick',
      NL: 'Newfoundland and Labrador',
      NS: 'Nova Scotia',
      NT: 'Northwest Territories',
      NU: 'Nunavut',
      ON: 'Ontario',
      PE: 'Prince Edward Island',
      QC: 'Quebec',
      SK: 'Saskatchewan',
      YT: 'Yukon',
    },
    {
      ON: { data: hst(1300) },
      NB: { data: hst(1500) },
      NL: { data: hst(1500) },
      NS: {
        data: hst(1400),
        notes: [
          'NS: the HST is 14 % from 2025-04-01 (15 % before). The rate is not dated here, so a report for early 2025 shows 14 % too.',
        ],
        sources: [
          'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html',
        ],
      },
      PE: { data: hst(1500) },
      QC: {
        data: { pension: null },
        notes: ['Quebec has its own pension plan (QPP); it is not estimated here.'],
      },
    },
  ),
  data: {
    salesTax: [{ key: 'gst', label: 'GST', rateBp: 500 }],
    pension: {
      plan: 'CPP',
      params: {
        ympe: cpp('Maximum pensionable earnings', 'cents', 7_130_000, 7_460_000, 7_670_000),
        yampe: cpp(
          'Additional maximum pensionable earnings',
          'cents',
          8_120_000,
          8_500_000,
          8_740_000,
        ),
        exemption: cpp('Basic exemption', 'cents', 350_000, 350_000),
        selfBp: cpp('Self-employed rate, first band (both halves)', 'bp', 1190, 1190),
        self2Bp: cpp('Self-employed rate, second band (CPP2)', 'bp', 800, 800),
      },
    },
    logbook: {
      readings:
        'The CRA asks for the odometer reading at the start and end of each fiscal period, which is the calendar year for most self-employed drivers.',
      notes: [
        'A full 12-month logbook can serve as a base year; a 3-month sample can then be used while the business use it shows stays within 10 percentage points of the base year (a 49% base year accepts 39% to 59%). MileWage stores the readings but has no base-year or sample mode. Check the rules with the CRA.',
      ],
    },
    platforms: offer(
      'doordash',
      'ubereats',
      'skipthedishes',
      'foodora',
      'instacart',
      'amazonflex',
      'other',
    ),
  },
  // Today's use only (plan 21 Q8): delivery work by independent contractors.
  work: ['delivery'],
  statuses: [{ status: 'contractor' }],
  tax: caTax,
  mileage: {
    yearStarts: '01-01',
    // The driver chooses per vehicle and year (apps/server mileage-deduction.ts), in every country today.
    methods: ['per_distance', 'actual_costs'],
    rates: { car: allowance, van: allowance, motorcycle: allowance },
    note: 'In Canada the per-km rate is the CRA limit on tax-exempt allowances an employer pays, not a deduction a self-employed driver can claim. Treat the mileage deduction as an estimate: the CRA asks the self-employed to claim their actual motor vehicle expenses, with receipts and a record of total and business kilometres.',
  },
  sources: [CRA_ALLOWANCE],
  verified: false,
  notes: [
    'Provincial rates; the territories have a rate 4 cents higher that is not used.',
    'Checked by the owner against the CRA pages on 2026-11-11: the per-km rates for 2024 to 2026, the CPP ceilings, exemption and self-employed rates for 2025 and 2026, the 2027 CPP ceilings (published 2026-10-28), GST and HST by province, and the odometer and logbook wording.',
    'Still open: the 2027 CPP contribution rate (so 2027 has no contribution estimate), whether the per-km rates cover motorcycles (the CRA pages say "automobile or motor vehicle"), and the 2027 per-km rates, usually published in December or January.',
    'The per-km rate is the limit for tax-exempt allowances an employer pays, not a deduction method for the self-employed; the mileage note says so to the driver.',
  ],
};
