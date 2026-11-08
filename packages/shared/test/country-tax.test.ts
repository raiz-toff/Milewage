import { describe, expect, test } from 'vitest';
import { caCountry, countryModules, resolvePlace } from '../src/countries/index';
import { estimateTax, type TaxEstimate } from '../src/countries/tax';
import frozen from './fixtures/ca-tax-grid.json';

// Every estimate of the CA tax pack before plan 21, written out by it before it was replaced
// (J3a): net|taxable|cpp|cpp2|note|income tax|total|instalment|sales tax; empty means null.
const old = (e: TaxEstimate) => {
  const [cpp, cpp2, tax] = e.lines;
  const sales = e.sales_tax ? Object.values(e.sales_tax).join('/') : null;
  return [e.net_income_cents, e.taxable_income_cents, cpp?.cents, cpp2?.cents, cpp?.note]
    .concat([tax?.cents, e.total_set_aside_cents, e.instalment_cents, sales])
    .map((x) => x ?? '')
    .join('|');
};

describe('tax packs as strategies with lines (plan 21 section 3.5)', () => {
  test('CA gives the same estimate as before for 1,680 inputs, now as lines', () => {
    const got: string[] = [];
    for (const year of [2023, 2024, 2025, 2026, 2027])
      for (const region of [null, 'XX', 'AB', 'ON', 'NS', 'QC', 'PE'])
        for (const incomeCents of [0, 300_000, 5_000_000, 8_000_000, 9_000_000, 20_000_000])
          for (const [expensesCents, mileageCents] of [
            [0, 0],
            [400_000, 7300],
          ] as const)
            for (const setAsideBp of [2000, 2500])
              for (const salesTaxRegistered of [false, true]) {
                const input = {
                  year,
                  region,
                  incomeCents,
                  expensesCents,
                  mileageCents,
                  setAsideBp,
                };
                const e = estimateTax(caCountry, {
                  ...input,
                  salesTaxRegistered,
                  collectedCents: 100_000,
                  creditCents: 200,
                });
                got.push(old(e!));
              }
    expect(got).toEqual(frozen);
  });

  test('only CA has a tax pack today (the lines add up: country-conformance.test.ts)', () => {
    expect(
      countryModules
        .list()
        .filter((c) => c.tax)
        .map((c) => c.code),
    ).toEqual(['CA']);
  });

  test('CA deadlines, slip and labels are unchanged; the CPP figures end with 2026', () => {
    const ca = caCountry.tax!;
    expect(ca.deadlines(2026, resolvePlace(caCountry, 'ON')).map((d) => d.date)).toEqual(
      '2026-03-15 2026-06-15 2026-09-15 2026-12-15 2027-04-30 2027-06-15'.split(' '),
    );
    expect([ca.slip, ca.verified]).toEqual([{ name: 'T4A', thresholdCents: 50_000 }, false]);
    const e = estimateTax(caCountry, { ...base, region: 'ON' })!;
    expect(e.lines.map((l) => [l.key, l.label])).toEqual([
      ['pension_contribution', 'Pension contribution (self-employed)'],
      ['pension_contribution_second_band', 'Pension, second band'],
      ['income_tax_set_aside', 'Income tax at 25%'],
    ]);
  });
});

const base = {
  year: 2026,
  incomeCents: 1,
  expensesCents: 0,
  mileageCents: 0,
  setAsideBp: 2500,
  salesTaxRegistered: false,
  collectedCents: 0,
  creditCents: 0,
};
