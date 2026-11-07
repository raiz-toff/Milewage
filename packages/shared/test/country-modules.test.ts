import { describe, expect, test } from 'vitest';
import { caPack, gbPack, usPack, type CountryPack, type VehicleKind } from '../src/countries';
import {
  caCountry,
  countryModules,
  gbCountry,
  mileageDeduction,
  periodStart,
  resolvePlace,
  salesTaxRateBp,
  usCountry,
  type CountryModule,
} from '../src/countries/index';
import { caTaxPack } from '../src/tax';

const MILE = 1609.344;
const KINDS: VehicleKind[] = ['car', 'motorcycle', 'van', 'bicycle', 'ebike', 'scooter', 'walking'];
const DATES = (
  '2023-12-31 2024-01-01 2024-04-05 2024-04-06 2025-06-30 2026-04-05 2026-04-06 ' +
  '2026-06-30 2026-07-01 2026-12-31 2027-01-01 2027-04-06'
).split(' ');
const TOTALS = [0, 1, 6.85, 102.6, 102.7, 999.5, 10_000, 1_234_567, 20_000_000, 15_000 * MILE];
const PRIORS = [0, 4_000_000, 9_000_000, 16_000_000, 9_999 * MILE];

describe('CA, US and GB as country modules (plan 21, J1b)', () => {
  test.each([
    [caPack, caCountry],
    [usPack, usCountry],
    [gbPack, gbCountry],
  ] as [CountryPack, CountryModule][])('%# same deduction and period as the old pack', (old, c) => {
    for (const date of DATES) {
      expect(periodStart(c.mileage, date), date).toBe(old.periodStart(date));
      for (const vehicleKind of KINDS)
        for (const totalM of TOTALS)
          for (const priorM of PRIORS) {
            const i = { totalM, priorM, date, vehicleKind };
            expect(mileageDeduction(c, i), JSON.stringify(i)).toBe(old.deduction(i));
          }
    }
    expect(c.places.map((p) => p.code)).toEqual(old.regions.map((r) => `${c.code}-${r}`));
    expect([c.unit, c.verified, c.sources]).toEqual([old.unit, old.verified, old.sources]);
  });

  test('tiered rates round twice, as before: to 1/100 cent, then to a cent (plan 21 section 8)', () => {
    const at = (totalM: number) =>
      mileageDeduction(caCountry, { totalM, priorM: 0, date: '2026-02-01', vehicleKind: 'car' });
    expect((102.7 * 73) / 1000).toBeCloseTo(7.4971); // rounded once this would be 7
    expect(at(102.7)).toBe(8);
    expect(at(102.6)).toBe(7);
  });

  test('CA sales tax and pension data match the tax pack the estimate still reads', () => {
    for (const p of caCountry.places) {
      const region = p.code.slice(3);
      const place = resolvePlace(caCountry, region);
      expect(salesTaxRateBp(place.data.salesTax ?? []), region).toBe(
        caTaxPack.salesTaxBp[region] ?? caTaxPack.defaultSalesTaxBp,
      );
      expect(place.data.pension === null, region).toBe(caTaxPack.ownPensionPlan.includes(region));
    }
    expect(resolvePlace(caCountry, null).data.pension).toEqual({ plan: 'CPP' });
  });

  test('the process registry lists the three countries and nothing else', () => {
    expect(countryModules.codes()).toEqual(['CA', 'US', 'GB']);
    expect(countryModules.get('gb')).toBe(gbCountry);
    expect(countryModules.list().map((c) => c.currency)).toEqual(['CAD', 'USD', 'GBP']);
  });
});
