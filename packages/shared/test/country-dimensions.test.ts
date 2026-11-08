import { describe, expect, test } from 'vitest';
import { EXPENSE_CATEGORIES } from '../src/expense-categories';
import {
  caCountry,
  combineData,
  countryModules,
  dataProblems,
  dimensionProblems,
  expenseCategoriesFor,
  MILEAGE_METHODS,
  OECD_FIELDS,
  PAYERS,
  TAX_REGIMES,
  WORK_KINDS,
  WORKER_STATUSES,
  type CountryModule,
  type OecdField,
  type WorkKind,
} from '../src/countries/index';

// Plan 21 section 3.6a and owner decision Q8: the dimensions are closed lists in the contract.
// ZZ is a user-assigned ISO code; nothing below describes a real country.
const zz: CountryModule = { ...caCountry, code: 'ZZ' };

describe('country dimensions (plan 21 section 3.6a)', () => {
  test('the closed lists', () => {
    expect(WORK_KINDS).toEqual(['delivery', 'ride_hailing', 'moto_taxi', 'courier']);
    expect(WORKER_STATUSES).toEqual(['contractor', 'employee', 'micro_business']);
    expect(TAX_REGIMES).toEqual(['net_profit', 'presumptive', 'flat_fee', 'withheld_final']);
    expect(MILEAGE_METHODS).toEqual(['per_distance', 'actual_costs', 'none']);
    expect(PAYERS).toEqual(['platform', 'cash', 'wallet']);
    expect(OECD_FIELDS).toHaveLength(6);
  });

  test("CA, US and GB declare today's use only: delivery by contractors, no money flow yet", () => {
    for (const c of countryModules.list()) {
      expect([c.code, c.work, c.statuses]).toEqual([
        c.code,
        ['delivery'],
        [{ status: 'contractor' }],
      ]);
      expect(c.mileage.methods).toEqual(['per_distance', 'actual_costs']);
      expect([c.income, c.expenseOverrides, c.data.filing]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }
    expect(caCountry.tax?.regimes).toEqual(['net_profit']);
  });

  test('a value outside a list, or a missing answer, is a problem', () => {
    const bad: CountryModule = {
      ...zz,
      work: ['delivery', 'boat' as WorkKind, 'delivery'],
      statuses: [{ status: 'micro_business' }],
      mileage: { ...zz.mileage, methods: ['none', 'actual_costs'] },
      tax: { ...zz.tax!, regimes: [] },
      income: {
        payers: ['cash', 'card' as 'cash'],
        tipsCommon: true,
        payoutsTaxInclusive: null,
        payoutRhythm: ['weekly'],
        platformIssuesSlip: false,
      },
      expenseOverrides: { relabel: { nothing: 'X' }, add: [{ ...EXPENSE_CATEGORIES[0]! }] },
    };
    expect(dimensionProblems(bad)).toEqual([
      'work: boat is not one of delivery,ride_hailing,moto_taxi,courier',
      'work: delivery listed twice',
      'statuses: micro_business needs the country label',
      'mileage methods: per_distance exactly when there are rates',
      'mileage methods: none stands alone',
      'tax regimes: at least one is required',
      'income payers: card is not one of platform,cash,wallet',
      'expense overrides: no category nothing to relabel',
      'expense overrides: fuel already exists',
    ]);
    expect(dimensionProblems({ ...zz, work: [], statuses: [] })).toEqual([
      'work: at least one kind is required',
      'statuses: at least one is required',
    ]);
  });

  test('expense overrides relabel and add categories; without them the shared list is unchanged', () => {
    expect(expenseCategoriesFor(caCountry)).toEqual(EXPENSE_CATEGORIES);
    const own = { ...EXPENSE_CATEGORIES[0]!, slug: 'vehicle_rent', label: 'Vehicle rent' };
    const list = expenseCategoriesFor({
      ...zz,
      expenseOverrides: { relabel: { fuel: 'Petrol' }, add: [own] },
    });
    expect(list[0]?.label).toBe('Petrol');
    expect(list.at(-1)).toEqual(own);
    expect(list).toHaveLength(EXPENSE_CATEGORIES.length + 1);
  });

  test('the filing slot: nearest level wins; registration and statement are checked', () => {
    const statement = {
      name: 'Yearly statement',
      due: '01-31',
      oecdFields: [],
      copyToDriver: true,
    };
    const own = { salesTaxRegistration: { kind: 'platform_collects' as const } };
    expect(combineData({ filing: { platformStatement: statement } }, { filing: own }).filing).toBe(
      own,
    );
    expect(
      dataProblems({
        filing: {
          salesTaxRegistration: {
            kind: 'threshold',
            thresholdCents: { label: 'Threshold', unit: 'cents', reference: [], values: {} },
          },
          platformStatement: {
            ...statement,
            name: ' ',
            due: '31 Jan',
            oecdFields: ['x' as OecdField],
          },
        },
      }),
    ).toEqual([
      'filing: a reference is required',
      'filing: no value is set',
      'filing: not ended by a final null',
      'filing: the statement needs a name',
      'filing: due must be MM-DD',
      'filing: x is not an OECD field',
    ]);
  });
});
