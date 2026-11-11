import { describe, expect, test } from 'vitest';
import {
  gbCountry,
  ownPeriodStart,
  ownRateAt,
  ownRateDeduction,
  paperSize,
  rateSourceAt,
  usCountry,
  type CountryModule,
  type DatedOwnRate,
} from '../src';

// ADR 0007: your mileage rate has dates and, when chosen, replaces the country's from its date.
const rate = (effectiveFrom: string | null, centsPerUnit: number): DatedOwnRate => ({
  effectiveFrom,
  centsPerUnit,
  unit: 'mi',
});
const none: CountryModule = {
  ...gbCountry,
  code: 'ZZ',
  mileage: { yearStarts: '01-01', methods: ['none'], rates: {} },
};

describe('the rate in force', () => {
  const rates = [rate('2026-07-01', 60), rate(null, 40), rate('2026-01-01', 50)];

  test('is the latest that starts on or before the day; the undated one comes first', () => {
    expect(ownRateAt(rates, '2025-12-31')?.centsPerUnit).toBe(40);
    expect(ownRateAt(rates, '2026-01-01')?.centsPerUnit).toBe(50);
    expect(ownRateAt(rates, '2026-06-30')?.centsPerUnit).toBe(50);
    expect(ownRateAt(rates, '2026-07-01')?.centsPerUnit).toBe(60);
    expect(ownRateAt(rates.slice(0, 1), '2026-06-30')).toBeNull();
    expect(ownRateAt([], '2026-06-30')).toBeNull();
  });
});

describe('which rate values a day', () => {
  const dated = [rate('2026-07-01', 60)];

  test('the country rate until you choose yours, and before your first date', () => {
    expect(rateSourceAt(usCountry, { rates: dated, use: false }, '2026-08-01')).toBe('official');
    expect(rateSourceAt(usCountry, { rates: dated, use: true }, '2026-06-30')).toBe('official');
    expect(rateSourceAt(usCountry, { rates: dated, use: true }, '2026-07-01')).toBe('yours');
    expect(rateSourceAt(usCountry, { rates: [], use: true }, '2026-07-01')).toBe('official');
  });

  test('without country rates your rate applies whatever the switch says (Q5)', () => {
    expect(rateSourceAt(none, { rates: dated, use: false }, '2026-07-01')).toBe('yours');
    expect(rateSourceAt(none, { rates: dated, use: false }, '2026-06-30')).toBe('none');
    expect(rateSourceAt(undefined, { rates: [], use: true }, '2026-06-30')).toBe('none');
  });
});

test('paper follows CLDR: Letter in the Americas that use it, A4 elsewhere', () => {
  expect(['US', 'ca', 'MX', 'PH'].map(paperSize)).toEqual(['letter', 'letter', 'letter', 'letter']);
  expect(['GB', 'DE', 'AU', 'IN', 'BR'].map(paperSize)).toEqual(['a4', 'a4', 'a4', 'a4', 'a4']);
});

test('your rate in two steps splits at the threshold, counting what was driven before', () => {
  const rate = {
    centsPerUnit: 70,
    unit: 'km' as const,
    tier: { thresholdUnits: 5000, afterCentsPerUnit: 64 },
  };
  const of = (totalM: number, priorM: number) =>
    ownRateDeduction(rate, { totalM, priorM, vehicleKind: 'car' });
  expect(of(10_000, 0)).toBe(700);
  expect(of(10_000, 4_995_000)).toBe(670); // 5 km at 70, 5 km at 64
  expect(of(10_000, 5_000_000)).toBe(640);
  expect(ownRateDeduction(rate, { totalM: 10_000, priorM: 0, vehicleKind: 'bicycle' })).toBeNull();
  // Without a step nothing changes: flat, whatever came before.
  expect(
    ownRateDeduction({ centsPerUnit: 70, unit: 'km' }, { totalM: 10_000, vehicleKind: 'car' }),
  ).toBe(700);
  expect(ownPeriodStart(undefined, '2026-05-01')).toBe('2026-01-01');
});
