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
  first: perMile('First 10,000 miles', { '2024-04-06': 45, '2026-04-06': 55, '2027-04-06': null }),
  after: perMile('After 10,000 miles', { '2024-04-06': 25, '2027-04-06': null }),
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
  mileage: {
    yearStarts: '04-06',
    rates: {
      car,
      van: car,
      motorcycle: {
        kind: 'flat',
        perUnit: perMile('Motorcycles', { '2024-04-06': 24, '2027-04-06': null }),
      },
    },
  },
  sources: [HMRC],
  verified: false,
  notes: [
    'UNVERIFIED: HMRC required log fields and rates stay unverified until a person checks them (17 M9.2).',
    'Fetched 2026-11-05: cars and goods vehicles 55p to 10,000 miles then 25p from 6 April 2026 (45p before), motorcycles 24p. Only the 2026-27 page was read, so earlier years are the 45p/25p of that statement, not independently seen.',
    'Bicycles: no rate is registered, so no deduction.',
  ],
};
