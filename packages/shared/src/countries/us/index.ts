// United States. Figures are copied unchanged from the packs that came before plan 21.

import { regionsOf, type MileageRate } from '../mileage';
import type { CountryModule } from '../types';

const IRS = 'https://www.irs.gov/tax-professionals/standard-mileage-rates';

/** Standard mileage rate for business use, flat, with one mid-year change in 2026. */
const standard: MileageRate = {
  kind: 'flat',
  perUnit: {
    label: 'Standard mileage rate, business',
    unit: 'cents/mi',
    reference: [IRS],
    values: {
      '2024-01-01': 67,
      '2025-01-01': 70,
      '2026-01-01': 72.5,
      '2026-07-01': 76,
      // The last published rate ends with its calendar year: nobody has announced 2027.
      '2027-01-01': null,
    },
  },
};

export const usCountry: CountryModule = {
  code: 'US',
  currency: 'USD',
  unit: 'mi',
  labels: { region: 'state' },
  // The 50 states and DC, names as in Google's address data (libaddressinput).
  places: regionsOf('US', {
    AL: 'Alabama',
    AK: 'Alaska',
    AZ: 'Arizona',
    AR: 'Arkansas',
    CA: 'California',
    CO: 'Colorado',
    CT: 'Connecticut',
    DE: 'Delaware',
    DC: 'District of Columbia',
    FL: 'Florida',
    GA: 'Georgia',
    HI: 'Hawaii',
    ID: 'Idaho',
    IL: 'Illinois',
    IN: 'Indiana',
    IA: 'Iowa',
    KS: 'Kansas',
    KY: 'Kentucky',
    LA: 'Louisiana',
    ME: 'Maine',
    MD: 'Maryland',
    MA: 'Massachusetts',
    MI: 'Michigan',
    MN: 'Minnesota',
    MS: 'Mississippi',
    MO: 'Missouri',
    MT: 'Montana',
    NE: 'Nebraska',
    NV: 'Nevada',
    NH: 'New Hampshire',
    NJ: 'New Jersey',
    NM: 'New Mexico',
    NY: 'New York',
    NC: 'North Carolina',
    ND: 'North Dakota',
    OH: 'Ohio',
    OK: 'Oklahoma',
    OR: 'Oregon',
    PA: 'Pennsylvania',
    RI: 'Rhode Island',
    SC: 'South Carolina',
    SD: 'South Dakota',
    TN: 'Tennessee',
    TX: 'Texas',
    UT: 'Utah',
    VT: 'Vermont',
    VA: 'Virginia',
    WA: 'Washington',
    WV: 'West Virginia',
    WI: 'Wisconsin',
    WY: 'Wyoming',
  }),
  data: {},
  mileage: { yearStarts: '01-01', rates: { car: standard, van: standard, motorcycle: standard } },
  sources: [IRS],
  verified: false,
  notes: [
    'Rates fetched from the IRS page on 2026-11-05 and not yet compared by a person.',
    'The 2026 rate changed on 1 July; a shift uses the rate of its local date.',
  ],
};
