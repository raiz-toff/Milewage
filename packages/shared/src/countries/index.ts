// Countries, regions and cities (plan 21). This is the only file that lists which countries ship:
// adding a country is a folder and one line below.

import { caCountry } from './ca';
import { gbCountry } from './gb';
import { createCountryModules } from './registry';
import { usCountry } from './us';

export * from './types';
export * from './dated';
export * from './slots';
export * from './resolve';
export * from './registry';
export * from './mileage';
export * from './name';
export * from './tax';
export * from './legacy';
export { caCountry, gbCountry, usCountry };

/** The countries of this process. */
export const countryModules = createCountryModules([caCountry, usCountry, gbCountry]);
