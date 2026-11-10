// The paper a printed report uses in a country, from Unicode CLDR's supplemental `paperSize`
// (`measurementData`, `<paperSize type="US-Letter">`): US Letter in these territories, A4
// everywhere else.

const LETTER = new Set([
  'BZ',
  'CA',
  'CL',
  'CO',
  'CR',
  'GT',
  'MX',
  'NI',
  'PA',
  'PH',
  'PR',
  'SV',
  'US',
  'VE',
]);

export type PaperSize = 'a4' | 'letter';

/** The paper size for an ISO 3166-1 country code (upper or lower case). */
export const paperSize = (country: string): PaperSize =>
  LETTER.has(country.toUpperCase()) ? 'letter' : 'a4';
