import { describe, expect, test } from 'vitest';
import grid from './fixtures/mileage-grid.json';
import {
  caCountry,
  countryModules,
  gbCountry,
  mileageDeduction,
  periodStart,
  resolvePlace,
  salesTaxRateBp,
  usCountry,
  type VehicleKind,
} from '../src/countries/index';

const MILE = 1609.344;
const KINDS: VehicleKind[] = ['car', 'motorcycle', 'van', 'bicycle', 'ebike', 'scooter', 'walking'];
const DATES = (
  '2023-12-31 2024-01-01 2024-04-05 2024-04-06 2025-06-30 2026-04-05 2026-04-06 ' +
  '2026-06-30 2026-07-01 2026-12-31 2027-01-01 2027-04-06'
).split(' ');
const TOTALS = [0, 1, 6.85, 102.6, 102.7, 999.5, 10_000, 1_234_567, 20_000_000, 15_000 * MILE];
const PRIORS = [0, 4_000_000, 9_000_000, 16_000_000, 9_999 * MILE];

// Every deduction and period start of the packs before plan 21, written out by them before they
// were removed (J1c), with GB's 2027-04-06 rewritten on 2026-11-11 for the announced 2027-28 rates. Order: date, vehicle kind, distance, earlier distance; empty means null.
const FROZEN: Record<string, string> = grid;

describe('CA, US and GB as country modules (plan 21)', () => {
  test.each([caCountry, usCountry, gbCountry])("$code gives the old packs' results", (c) => {
    const got: (number | null)[] = [];
    for (const date of DATES)
      for (const vehicleKind of KINDS)
        for (const totalM of TOTALS)
          for (const priorM of PRIORS)
            got.push(mileageDeduction(c, { totalM, priorM, date, vehicleKind }));
    expect(got.map((x) => x ?? '').join(',')).toBe(FROZEN[c.code]);
    expect(DATES.map((d) => periodStart(c.mileage, d)).join(',')).toBe(
      FROZEN[`${c.code} periodStart`],
    );
  });

  test('tiered rates round twice, as before: to 1/100 cent, then to a cent (plan 21 section 8)', () => {
    const at = (totalM: number) =>
      mileageDeduction(caCountry, { totalM, priorM: 0, date: '2026-02-01', vehicleKind: 'car' });
    expect((102.7 * 73) / 1000).toBeCloseTo(7.4971); // rounded once this would be 7
    expect(at(102.7)).toBe(8);
    expect(at(102.6)).toBe(7);
  });

  test('CA sales tax and pension by region (NS is 14 % since 2025-04-01)', () => {
    const old: Record<string, number> = { ON: 1300, NB: 1500, NL: 1500, NS: 1400, PE: 1500 };
    for (const p of caCountry.places) {
      const region = p.code.slice(3);
      const place = resolvePlace(caCountry, region);
      expect(salesTaxRateBp(place.data.salesTax ?? []), region).toBe(old[region] ?? 500);
      expect(place.data.pension === null, region).toBe(region === 'QC');
    }
  });

  test('the pre-plan-21 pack aliases are gone (J4)', async () => {
    const shared = await import('../src');
    for (const old of ['caPack', 'countryPacks', 'taxPacks', 'caTaxPack', 'createCountryRegistry'])
      expect(old in shared, old).toBe(false);
  });

  test('the process registry lists the three countries and nothing else', () => {
    expect(countryModules.codes()).toEqual(['US', 'CA', 'GB']); // the order of the old list
    expect(countryModules.get('gb')).toBe(gbCountry);
    expect(countryModules.list().map((c) => c.currency)).toEqual(['USD', 'CAD', 'GBP']);
  });
});
