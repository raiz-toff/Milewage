import { describe, expect, test } from 'vitest';
import {
  countryModules,
  countryName,
  dataProblems,
  datedProblems,
  mileageDeduction,
  notAutomobile,
  periodStart,
  resolvePlace,
  type VehicleKind,
} from '../src/countries/index';

// The contract every registered country meets (plan 21 section 3.8). A new country fails here
// until it does. J6 adds the ISO 3166-2 code list and the no-country-literal lint rule.
const KINDS: VehicleKind[] = ['car', 'motorcycle', 'van', 'bicycle', 'ebike', 'scooter', 'walking'];
const currencies = new Set(Intl.supportedValuesOf('currency'));

describe.each(countryModules.list())('country $code meets the contract', (c) => {
  test('profile: ISO code with a CLDR name, ISO 4217 currency, unit, provenance', () => {
    expect(c.code).toMatch(/^[A-Z]{2}$/);
    expect(countryName(c.code)).not.toBe(c.code);
    expect(currencies.has(c.currency), c.currency).toBe(true);
    expect(['km', 'mi']).toContain(c.unit);
    expect(c.sources.length).toBeGreaterThan(0);
    expect(typeof c.verified).toBe('boolean');
    expect(Array.isArray(c.notes)).toBe(true);
    expect(dataProblems(c.data)).toEqual([]);
  });

  test('places: unique codes under an existing parent, named, resolvable, valid data', () => {
    const codes = new Set([c.code]);
    for (const p of c.places) {
      expect(codes.has(p.code), `${p.code} twice`).toBe(false);
      codes.add(p.code);
    }
    if (c.places.some((p) => p.parent === c.code)) expect(c.labels.region).toBeTruthy();
    for (const p of c.places) {
      expect(p.code, p.code).toMatch(new RegExp(`^${p.parent}-[A-Z0-9]{1,3}$`));
      expect(codes.has(p.parent), p.code).toBe(true);
      expect(p.name.trim(), p.code).not.toBe('');
      expect(resolvePlace(c, p.code).codes.at(-1), p.code).toBe(p.code);
      expect(dataProblems(p.data ?? {}), p.code).toEqual([]);
    }
  });

  test('mileage: dated rates ended by a null, none for non-automobiles, period start', () => {
    for (const [kind, rate] of Object.entries(c.mileage.rates)) {
      expect(notAutomobile(kind as VehicleKind), kind).toBe(false);
      const params = rate.kind === 'flat' ? [rate.perUnit] : [rate.first, rate.after];
      for (const p of params) expect(datedProblems(p), `${kind} ${p.label}`).toEqual([]);
    }
    for (const date of ['1900-01-01', '2100-01-01'])
      for (const vehicleKind of KINDS)
        expect(mileageDeduction(c, { totalM: 10_000, priorM: 0, date, vehicleKind })).toBeNull();
    expect(c.mileage.yearStarts).toMatch(/^\d{2}-\d{2}$/);
    for (const d of ['2025-01-01', '2025-04-05', '2025-04-06', '2025-12-31']) {
      const start = periodStart(c.mileage, d);
      expect(start <= d && start > `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`, d).toBe(true);
    }
  });
});
