// United Kingdom. Figures are copied unchanged from the packs that came before plan 21.

import { regionsOf, type MileageRate } from '../mileage';
import { offer } from '../slots';
import type { CountryModule, Dated } from '../types';

const HMRC = 'https://www.gov.uk/simpler-income-tax-simplified-expenses/vehicles';
const perMile = (label: string, values: Dated<number>['values']): Dated<number> => ({
  label,
  unit: 'pence/mi',
  reference: [HMRC],
  values,
});

/** Simplified expenses flat rates: cars and goods vehicles, 10,000 miles tier per tax year. */
const car: MileageRate = {
  kind: 'tiered',
  thresholdUnits: 10_000,
  first: perMile('First 10,000 miles', { '2024-04-06': 45, '2026-04-06': 55, '2028-04-06': null }),
  after: perMile('After 10,000 miles', { '2024-04-06': 25, '2027-04-06': 35, '2028-04-06': null }),
};

export const gbCountry: CountryModule = {
  code: 'GB',
  currency: 'GBP',
  unit: 'mi',
  labels: { region: 'nation' },
  places: regionsOf('GB', {
    ENG: 'England',
    NIR: 'Northern Ireland',
    SCT: 'Scotland',
    WLS: 'Wales',
  }),
  data: { platforms: offer('ubereats', 'amazonflex', 'deliveroo', 'justeat', 'other') },
  // Today's use only (plan 21 Q8): delivery work by independent contractors.
  work: ['delivery'],
  statuses: [{ status: 'contractor' }],
  mileage: {
    yearStarts: '04-06',
    methods: ['per_distance', 'actual_costs'],
    rates: {
      car,
      van: car,
      motorcycle: {
        kind: 'flat',
        perUnit: perMile('Motorcycles', { '2024-04-06': 24, '2028-04-06': null }),
      },
    },
  },
  sources: [HMRC],
  verified: false,
  notes: [
    'UNVERIFIED: the HMRC required log fields have not been checked by a person.',
    'Rates checked by the owner against gov.uk on 2026-11-11: 45p then 25p up to 2025-26, 55p then 25p for 2026-27, motorcycles 24p throughout.',
    '2027-28 (from 6 April 2027): 55p then 35p was announced at Budget 2026 and is not yet law; no change was announced for motorcycles, so 24p is carried on. Check again when HMRC publishes the 2027-28 page.',
    'Not confirmed: that the 10,000-mile count totals all of a self-employed driver’s vehicles (HMRC says so for employees).',
    'Bicycles: no rate is registered, so no deduction.',
  ],
};
