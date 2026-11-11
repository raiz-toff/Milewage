// Canada's estimate: CPP on net self-employment income and the driver's own set-aside rate. The
// CPP figures are the `pension` slot (QC sets it to null: own plan); the sales tax rate is the
// `salesTax` slot (GST, or HST where it replaces it). Figures are unchanged from before plan 21.

import { valueAt } from '../dated';
import { salesTaxRateBp } from '../slots';
import { half, type TaxPack } from '../tax';

export const caTax: TaxPack = {
  verified: false,
  checkedAgainst: 'the CRA publications',
  regimes: ['net_profit'],
  sources: [
    'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html',
    'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-10100-employment-income/employment-income-slips/t4a.html',
  ],
  notes: [
    'Checked by the owner against the CRA pages on 2026-11-11: the CPP figures for 2025 and 2026, the instalment threshold and dates, the balance and filing dates and the T4A threshold. Not handled: a due date on a weekend or holiday moves to the next business day; the T4A wording is "more than $500".',
    'CPP2 and the second ceiling exist only for 2024 onward; years not listed have no contribution estimate.',
    'Quebec (QPP) is not in the pack: the estimate leaves the pension contribution out for region QC.',
    'Income tax is the driver’s own set-aside rate, a planning figure, not tax brackets.',
  ],
  slip: { name: 'T4A', thresholdCents: 50_000 },

  estimate(i, place) {
    const net = i.incomeCents - i.expensesCents - i.mileageCents;
    const taxable = Math.max(0, net);
    const pension = place.data.pension;
    const at = (key: string) => {
      const p = pension?.params[key];
      return p ? valueAt(p, `${i.year}-01-01`) : null;
    };
    const [ympe, yampe, exemption, selfBp, self2Bp] = [
      'ympe',
      'yampe',
      'exemption',
      'selfBp',
      'self2Bp',
    ].map(at);
    let cpp1: number | null = null;
    let cpp2: number | null = null;
    let note: string | null = null;
    if (pension === null)
      note = `Region ${i.region} has its own pension plan; it is not estimated here.`;
    else if (
      ympe == null ||
      yampe == null ||
      exemption == null ||
      selfBp == null ||
      self2Bp == null
    )
      note = `The pack has no contribution figures for ${i.year}.`;
    else {
      const first = Math.max(0, Math.min(taxable, ympe) - exemption);
      const second = Math.max(0, Math.min(taxable, yampe) - ympe);
      cpp1 = half((first * selfBp) / 10_000);
      cpp2 = half((second * self2Bp) / 10_000);
    }
    const tax = half((taxable * i.setAsideBp) / 10_000);
    const total = tax + (cpp1 ?? 0) + (cpp2 ?? 0);
    return {
      net_income_cents: net,
      taxable_income_cents: taxable,
      lines: [
        {
          key: 'pension_contribution',
          label: 'Pension contribution (self-employed)',
          cents: cpp1,
          note,
        },
        {
          key: 'pension_contribution_second_band',
          label: 'Pension, second band',
          cents: cpp2,
          note: null,
        },
        {
          key: 'income_tax_set_aside',
          label: `Income tax at ${i.setAsideBp / 100}%`,
          cents: tax,
          note: null,
        },
      ],
      total_set_aside_cents: total,
      instalment_cents: half(total / 4),
      sales_tax: i.salesTaxRegistered
        ? {
            collected_cents: i.collectedCents,
            credits_cents: i.creditCents,
            owing_cents: i.collectedCents - i.creditCents,
            rate_bp: salesTaxRateBp(place.data.salesTax ?? []),
          }
        : null,
    };
  },

  deadlines: (y) => [
    { date: `${y}-03-15`, kind: 'instalment', label: 'Instalment 1' },
    { date: `${y}-06-15`, kind: 'instalment', label: 'Instalment 2' },
    { date: `${y}-09-15`, kind: 'instalment', label: 'Instalment 3' },
    { date: `${y}-12-15`, kind: 'instalment', label: 'Instalment 4' },
    { date: `${y + 1}-04-30`, kind: 'balance', label: 'Balance owing' },
    { date: `${y + 1}-06-15`, kind: 'filing', label: 'Self-employed filing' },
  ],
  instalmentsNote:
    'The CRA asks for instalments when your net tax owing is over $3,000 ($1,800 in Quebec) this year and in either of the two years before. It writes to you when it expects them.',
};
