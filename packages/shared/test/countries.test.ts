import { describe, expect, test } from 'vitest';
import {
  caCountry,
  createCountryModules,
  gbCountry,
  mileageDeduction,
  periodStart,
  usCountry,
  type CountryModule,
  type VehicleKind,
} from '../src/countries';

const MILE = 1609.344;
const d = (
  c: CountryModule,
  totalM: number,
  date: string,
  priorM = 0,
  vehicleKind: VehicleKind = 'car',
) => mileageDeduction(c, { totalM, priorM, date, vehicleKind });

describe('country packs (08 section 16.3)', () => {
  test('bicycles, e-bikes, scooters and walking are not automobiles in any pack (18 section 4.1)', () => {
    for (const c of [caCountry, usCountry, gbCountry]) {
      for (const kind of ['bicycle', 'ebike', 'scooter', 'walking'] as const) {
        expect(d(c, 10_000, '2026-03-01', 0, kind), `${c.code} ${kind}`).toBeNull();
      }
    }
    expect(d(caCountry, 10_000, '2026-03-01', 0, 'van')).toBe(730);
    expect(caCountry.places.map((p) => p.code)).toContain('CA-QC');
  });

  test('US: the rate of the shift date, including the mid-year change of 2026', () => {
    expect(d(usCountry, 10_000, '2024-06-01')).toBe(Math.round((10_000 / MILE) * 67));
    expect(d(usCountry, 10_000, '2025-06-01')).toBe(435);
    expect(d(usCountry, 10_000, '2026-06-30')).toBe(Math.round((10_000 / MILE) * 72.5));
    expect(d(usCountry, 10_000, '2026-07-01')).toBe(472);
    expect(d(usCountry, 10_000, '2023-12-31')).toBeNull(); // no rate registered
    expect(d(usCountry, 10_000, '2027-01-01')).toBeNull(); // nor carried into an unannounced year
    expect(d(gbCountry, 10_000, '2027-04-06')).toBeNull();
    expect(d(usCountry, 10_000, '2026-07-01', 0, 'bicycle')).toBeNull();
    expect(periodStart(usCountry.mileage, '2026-08-09')).toBe('2026-01-01');
  });

  test('CA: 5,000 km at the higher rate per calendar year, split inside a shift', () => {
    expect(d(caCountry, 1_000_000, '2026-02-01')).toBe(1000 * 73);
    expect(d(caCountry, 2_000_000, '2026-02-01', 4_000_000)).toBe(1000 * 73 + 1000 * 67);
    expect(d(caCountry, 2_000_000, '2026-02-01', 9_000_000)).toBe(2000 * 67);
    expect(d(caCountry, 1_000_000, '2025-02-01')).toBe(1000 * 72);
    expect(d(caCountry, 1_000_000, '2027-02-01')).toBeNull();
    expect(caCountry.unit).toBe('km');
  });

  test('GB: tax year from 6 April, 10,000 miles tier, motorcycles flat, bicycles none', () => {
    expect(periodStart(gbCountry.mileage, '2026-04-05')).toBe('2025-04-06');
    expect(periodStart(gbCountry.mileage, '2026-04-06')).toBe('2026-04-06');
    expect(d(gbCountry, 15_000 * MILE, '2026-05-01')).toBe(10_000 * 55 + 5_000 * 25);
    expect(d(gbCountry, 15_000 * MILE, '2026-03-01')).toBe(10_000 * 45 + 5_000 * 25);
    expect(d(gbCountry, MILE, '2026-05-01', 0, 'motorcycle')).toBe(24);
    expect(d(gbCountry, MILE, '2026-05-01', 0, 'bicycle')).toBeNull();
    expect(gbCountry.verified).toBe(false);
    expect(gbCountry.notes.join(' ')).toContain('UNVERIFIED');
  });

  test('no pack claims to have been checked by a person yet', () => {
    for (const p of [caCountry, usCountry, gbCountry]) expect(p.verified).toBe(false);
  });

  test('a new country registers without editing anything else; unknown codes have no pack', () => {
    const registry = createCountryModules([caCountry, usCountry, gbCountry]);
    expect(registry.codes().sort()).toEqual(['CA', 'GB', 'US']);
    expect(registry.get('fr')).toBeUndefined();
    const stub: CountryModule = {
      code: 'FR',
      currency: 'EUR',
      unit: 'km',
      labels: {},
      places: [],
      data: {},
      mileage: { yearStarts: '01-01', rates: {} },
      sources: [],
      verified: false,
      notes: [],
    };
    registry.register(stub);
    expect(registry.get('fr')).toBe(stub);
    expect(registry.codes()).toContain('FR');
  });
});
