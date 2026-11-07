import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  countryName,
  dataProblems,
  datedProblems,
  resolvePlace,
  salesTaxRateBp,
  valueAt,
  type CountryModule,
  type Dated,
  type PlaceData,
} from '../src/countries/index';

// ZZ is a user-assigned ISO code: these figures are made up and describe no real place.
const rate: Dated<number> = {
  label: 'Test rate',
  unit: 'cents/km',
  reference: ['https://example.org'],
  values: { '2025-01-01': 72, '2024-01-01': 70, '2026-01-01': null },
};
const tax = (key: string, rateBp: number, more = {}) => ({ key, label: key, rateBp, ...more });
const at = (code: string, parent: string, data?: PlaceData, more = {}) => ({
  ...{ code, parent, name: code, data },
  ...more,
});
const zz: CountryModule = {
  code: 'ZZ',
  currency: 'EUR',
  unit: 'km',
  labels: { region: 'province', city: 'city' },
  data: { salesTax: [tax('vat', 500)], pension: { plan: 'ZPP' } },
  places: [
    at('ZZ-AA', 'ZZ', { salesTax: [tax('pst', 700, { combinable: true })] }, { verified: true }),
    at('ZZ-RR', 'ZZ', { salesTax: [tax('hst', 1300)] }, { notes: ['RR note'] }),
    at('ZZ-QQ', 'ZZ', { pension: null }),
    at(
      'ZZ-AA-CTY',
      'ZZ-AA',
      { salesTax: [tax('c', 100, { combinable: true })] },
      { verified: true },
    ),
    at('ZZ-L1', 'ZZ-L2'),
    at('ZZ-L2', 'ZZ-L1'),
  ],
  sources: ['https://example.org'],
  verified: true,
  notes: ['national note'],
};
const keys = (code: string | null) => resolvePlace(zz, code).data.salesTax?.map((c) => c.key);

describe('dated parameters (OpenFisca shape)', () => {
  test('the value at a date is the last one started on or before it; the final null ends it', () => {
    expect(valueAt(rate, '2023-12-31')).toBeNull();
    expect(valueAt(rate, '2024-01-01')).toBe(70);
    expect(valueAt(rate, '2024-12-31')).toBe(70);
    expect(valueAt(rate, '2025-06-01')).toBe(72);
    expect(valueAt(rate, '2026-01-01')).toBeNull();
    expect(datedProblems(rate)).toEqual([]);
  });

  test('a parameter without a final null, a reference or valid dates is reported', () => {
    expect(datedProblems({ ...rate, values: { '2024-01-01': 70 } })).toEqual([
      'not ended by a final null',
    ]);
    expect(
      datedProblems({ ...rate, reference: [], values: { '2024-1-1': 1, '2025-01-01': null } }),
    ).toEqual(['a reference is required', 'bad date 2024-1-1']);
  });
});

describe('slots and the resolver', () => {
  test('sales tax: combinable components add to the parent, others replace (Medusa rule)', () => {
    expect(keys(null)).toEqual(['vat']);
    expect(keys('ZZ-AA')).toEqual(['vat', 'pst']);
    expect(keys('AA')).toEqual(['vat', 'pst']); // a region as settings store it today
    expect(keys('ZZ-RR')).toEqual(['hst']);
    expect(keys('ZZ-AA-CTY')).toEqual(['vat', 'pst', 'c']);
  });

  test('compound components are charged on top of the others (WooCommerce rule)', () => {
    expect(salesTaxRateBp([tax('a', 500), tax('b', 700)])).toBe(1200);
    expect(salesTaxRateBp([tax('b', 1000, { compound: true }), tax('a', 500)])).toBe(1550);
  });

  test('pension: nearest level wins, and an explicit null means not estimated here', () => {
    expect(resolvePlace(zz, 'ZZ-AA').data.pension).toEqual({ plan: 'ZPP' });
    expect(resolvePlace(zz, 'ZZ-QQ').data.pension).toBeNull();
  });

  test('unknown places and loops get national data; verified only if every source level is', () => {
    expect(resolvePlace(zz, 'XX').codes).toEqual(['ZZ']);
    expect(resolvePlace(zz, 'ZZ-L1').codes).toEqual(['ZZ']);
    expect(resolvePlace(zz, 'ZZ-AA-CTY').codes).toEqual(['ZZ', 'ZZ-AA', 'ZZ-AA-CTY']);
    expect(resolvePlace(zz, 'ZZ-AA-CTY').verified).toBe(true);
    const rr = resolvePlace(zz, 'ZZ-RR');
    expect(rr.verified).toBe(false);
    expect(rr.notes).toEqual(['national note', 'RR note']);
  });

  test('slot validation', () => {
    expect(dataProblems(zz.data)).toEqual([]);
    expect(dataProblems({ salesTax: [tax('a', 1.5), tax('a', 1)] })).toEqual([
      'a: rate must be 0 to 10000 bp',
      'a: listed twice',
    ]);
    expect(dataProblems({ pension: { plan: '' } })).toEqual(['pension: plan name is required']);
    expect(dataProblems({ nope: 1 } as never)).toEqual(['unknown slot nope']);
  });
});

describe('country names', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('country names come from CLDR, and fall back to the code without Intl.DisplayNames', () => {
    expect(countryName('ca')).toBe('Canada');
    expect(countryName('GB', 'fr')).toBe('Royaume-Uni');
    vi.stubGlobal('Intl', { ...Intl, DisplayNames: undefined });
    expect(countryName('CA')).toBe('CA');
  });
});
