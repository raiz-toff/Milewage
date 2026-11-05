import { describe, expect, test } from 'vitest';
import {
  caPack,
  createCountryRegistry,
  gbPack,
  usPack,
  type CountryPack,
  type VehicleKind,
} from '../src/countries';

const MILE = 1609.344;
const d = (
  pack: CountryPack,
  totalM: number,
  date: string,
  priorM = 0,
  vehicleKind: VehicleKind = 'car',
) => pack.deduction({ totalM, priorM, date, vehicleKind });

describe('country packs (08 section 16.3)', () => {
  test('US: the rate of the shift date, including the mid-year change of 2026', () => {
    expect(d(usPack, 10_000, '2024-06-01')).toBe(Math.round((10_000 / MILE) * 67));
    expect(d(usPack, 10_000, '2025-06-01')).toBe(435);
    expect(d(usPack, 10_000, '2026-06-30')).toBe(Math.round((10_000 / MILE) * 72.5));
    expect(d(usPack, 10_000, '2026-07-01')).toBe(472);
    expect(d(usPack, 10_000, '2023-12-31')).toBeNull(); // no rate registered
    expect(d(usPack, 10_000, '2026-07-01', 0, 'bicycle')).toBeNull();
    expect(usPack.periodStart('2026-08-09')).toBe('2026-01-01');
  });

  test('CA: 5,000 km at the higher rate per calendar year, split inside a shift', () => {
    expect(d(caPack, 1_000_000, '2026-02-01')).toBe(1000 * 73);
    expect(d(caPack, 2_000_000, '2026-02-01', 4_000_000)).toBe(1000 * 73 + 1000 * 67);
    expect(d(caPack, 2_000_000, '2026-02-01', 9_000_000)).toBe(2000 * 67);
    expect(d(caPack, 1_000_000, '2025-02-01')).toBe(1000 * 72);
    expect(d(caPack, 1_000_000, '2027-02-01')).toBeNull();
    expect(caPack.unit).toBe('km');
  });

  test('GB: tax year from 6 April, 10,000 miles tier, motorcycles flat, bicycles none', () => {
    expect(gbPack.periodStart('2026-04-05')).toBe('2025-04-06');
    expect(gbPack.periodStart('2026-04-06')).toBe('2026-04-06');
    expect(d(gbPack, 15_000 * MILE, '2026-05-01')).toBe(10_000 * 55 + 5_000 * 25);
    expect(d(gbPack, 15_000 * MILE, '2026-03-01')).toBe(10_000 * 45 + 5_000 * 25);
    expect(d(gbPack, MILE, '2026-05-01', 0, 'motorcycle')).toBe(24);
    expect(d(gbPack, MILE, '2026-05-01', 0, 'bicycle')).toBeNull();
    expect(gbPack.verified).toBe(false);
    expect(gbPack.notes.join(' ')).toContain('UNVERIFIED');
  });

  test('no pack claims to have been checked by a person yet', () => {
    for (const p of [caPack, usPack, gbPack]) expect(p.verified).toBe(false);
  });

  test('a new country registers without editing anything else; unknown codes have no pack', () => {
    const registry = createCountryRegistry();
    expect(registry.codes().sort()).toEqual(['CA', 'GB', 'US']);
    expect(registry.get('fr')).toBeUndefined();
    const stub: CountryPack = {
      code: 'FR',
      unit: 'km',
      periodStart: (x) => `${x.slice(0, 4)}-01-01`,
      deduction: (i) => i.totalM,
      sources: [],
      verified: false,
      notes: [],
    };
    registry.register(stub);
    expect(registry.get('fr')).toBe(stub);
    expect(registry.codes()).toContain('FR');
  });
});
