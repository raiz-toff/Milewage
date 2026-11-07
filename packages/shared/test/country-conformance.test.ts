import { describe, expect, test } from 'vitest';
import iso from './fixtures/iso-3166-2.json';
import {
  countryModules,
  countryName,
  dataProblems,
  datedProblems,
  dimensionProblems,
  mileageDeduction,
  notAutomobile,
  periodStart,
  resolvePlace,
  type VehicleKind,
} from '../src/countries/index';

// The contract every registered country meets (plan 21 section 3.8). A new country fails here
// until it does. The no-country-literal lint rule has its own test (country-lint-rule.test.ts).
// Region codes are checked against CLDR's ISO 3166-2 list (scripts/iso-subdivisions.mjs).
const subdivisions = new Set(Object.values(iso.codes as Record<string, string[]>).flat());
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
    // Work kinds, statuses, mileage methods, tax regimes, money flow, expense overrides (3.6a).
    expect(dimensionProblems(c)).toEqual([]);
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
      // A region is an ISO 3166-2 code; a city is its region plus a UN/LOCODE location part.
      if (p.parent === c.code)
        expect(subdivisions.has(p.code), `${p.code} in ISO 3166-2`).toBe(true);
      else expect(p.code, p.code).toMatch(new RegExp(`^${p.parent}-[A-Z2-9]{3}$`));
    }
  });

  test.skipIf(!c.tax)(
    'tax: provenance, slip, deadlines in order, lines that add up everywhere',
    () => {
      const t = c.tax!;
      expect(t.sources.length).toBeGreaterThan(0);
      expect(typeof t.verified).toBe('boolean');
      expect(t.checkedAgainst.trim()).not.toBe('');
      if (t.slip) expect(t.slip.name.trim() && t.slip.thresholdCents >= 0).toBeTruthy();
      for (const code of [null, ...c.places.map((p) => p.code)]) {
        const place = resolvePlace(c, code);
        const dates = t.deadlines(2026, place).map((d) => d.date);
        expect(dates, `${code}`).toEqual([...dates].sort());
        expect(
          dates.every((d) => d >= '2026-01-01' && d < '2028-01-01'),
          `${code}`,
        ).toBe(true);
        const e = t.estimate(
          {
            ...{ year: 2026, region: code, incomeCents: 9_000_000, expensesCents: 100_000 },
            ...{ mileageCents: 50_000, setAsideBp: 2500, salesTaxRegistered: true },
            ...{ collectedCents: 0, creditCents: 0 },
          },
          place,
        );
        const sum = e.lines.reduce((a, l) => a + (l.cents ?? 0), 0);
        expect(sum, `${code}`).toBe(e.total_set_aside_cents);
      }
    },
  );

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
