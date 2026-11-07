// Canada. Figures are copied unchanged from the packs that came before plan 21.

import { regionsOf, type MileageRate } from '../mileage';
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
        data: hst(1500),
        notes: [
          'NS: the CRA GST/HST calculator page says the HST is 14 % from 2025-04-01; 15 % is kept until a person checks it.',
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
  data: { salesTax: [{ key: 'gst', label: 'GST', rateBp: 500 }], pension: { plan: 'CPP' } },
  mileage: {
    yearStarts: '01-01',
    rates: { car: allowance, van: allowance, motorcycle: allowance },
  },
  sources: [CRA_ALLOWANCE],
  verified: false,
  notes: [
    'Provincial rates; the territories have a higher rate that is not used.',
    'Rates fetched from the CRA page on 2026-11-05 and not yet compared by a person.',
    'The allowance rate is not the same thing as a motor vehicle expense deduction; no claim is made about which method applies.',
    'Sales tax and pension data are copied from the tax pack, written from memory and not compared with the CRA pages.',
  ],
};
