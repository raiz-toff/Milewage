import { expenseCategory } from '@milewage/shared';
import { createExpenseRepository, createProcessingRepository } from '../db';
import { deductionMethodFor } from '../deduction-method';
import { deductibleCents, doubleCounts } from '../expense-math';
import { deductionOfShift } from '../processing/presenter';
import { cell, money } from './csv';
import type { ExportContext, Exporter } from './registry';

const CRLF = '\r\n';
const row = (cells: (string | number | null | undefined)[]) => cells.map(cell).join(',') + CRLF;
const NOT_ADVICE = 'Estimate to bring to an accountant, not tax advice. Nothing here is filed.';

/** Expenses of a date range for the accountant (18 section 10.3). Receipt files are not included. */
export const expensesExporter: Exporter = {
  format: 'expenses',
  standalone: true,
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  requires: ['expenses'],
  *run(c: ExportContext) {
    const year = c.query.year ?? Number(c.today.slice(0, 4));
    const from = c.query.from ?? `${year}-01-01`;
    const to = c.query.to ?? `${year}-12-31`;
    yield row([
      'Date',
      'Category',
      'Merchant',
      'Amount',
      'Deductible',
      'Business_Use_Pct',
      'Deductible_Amount',
      'Tax_Credit',
      'Vehicle',
      'Shift_Date',
      'Receipt',
      'Recurring',
      'Notes',
      'Covered_By_Mileage_Rate',
    ]);
    const shiftDate = c.db
      .prepare('SELECT local_date FROM shifts WHERE id = ? AND user_id = ?')
      .pluck();
    for (const e of createExpenseRepository(c.db).between(c.userId, from, to)) {
      if (c.query.category && e.category !== c.query.category) continue;
      const covered = doubleCounts(c.db, c.userId, e);
      yield row([
        e.spentOn,
        expenseCategory(e.category)?.label ?? e.category,
        e.merchant,
        money(e.amountCents),
        e.deductible === 1 ? 'yes' : 'no',
        e.businessPct,
        money(covered ? 0 : deductibleCents(e)),
        money(e.taxCreditCents),
        e.vehicleId === null ? '' : (c.vehicles.get(e.vehicleId)?.name ?? ''),
        e.shiftId === null ? '' : String(shiftDate.get(e.shiftId, c.userId) ?? ''),
        createExpenseRepository(c.db).receiptFile(e.id) ? 'yes' : 'no',
        e.templateId === null ? 'no' : 'yes',
        e.notes,
        covered ? 'yes' : 'no',
      ]);
    }
  },
};

/** The numbers behind the estimate of a year, with the working (18 section 10.3). CSV or JSON. */
export const taxSummaryExporter: Exporter = {
  format: 'tax_summary',
  standalone: true,
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  requires: ['tax'],
  describe: (c) =>
    c.query.format === 'json'
      ? { contentType: 'application/json; charset=utf-8', extension: 'json' }
      : { contentType: 'text/csv; charset=utf-8', extension: 'csv' },
  *run(c: ExportContext) {
    const year = c.query.year ?? Number((c.query.from ?? c.today).slice(0, 4));
    const report = c.taxReport!(year);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    // The working that the report keeps as totals: spending per category and mileage per vehicle and method.
    const byCategory = new Map<string, number>();
    if (c.enabled('expenses')) {
      for (const e of createExpenseRepository(c.db).between(c.userId, from, to)) {
        if (doubleCounts(c.db, c.userId, e)) continue;
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + deductibleCents(e));
      }
    }
    const mileage = new Map<number, number>();
    for (const s of createProcessingRepository(c.db).shiftsInPeriod(c.userId, from, to)) {
      const v = deductionOfShift(c.db, s);
      if (v !== null) mileage.set(s.vehicleId, (mileage.get(s.vehicleId) ?? 0) + v);
    }
    const vehicles = [...c.vehicles.values()]
      .filter(
        (v) => mileage.has(v.id) || report.deductions?.vehicles.some((x) => x.vehicle_id === v.id),
      )
      .map((v) => ({
        vehicle: v.name,
        method: deductionMethodFor(c.db, c.userId, v.id, year),
        mileage_deduction_cents: mileage.get(v.id) ?? null,
      }));
    const expenses_by_category = [...byCategory].map(([category, deductible_cents]) => ({
      category,
      deductible_cents,
    }));
    if (c.query.format === 'json') {
      yield JSON.stringify(
        { ...report, expenses_by_category, vehicles, disclaimer: NOT_ADVICE },
        null,
        2,
      ) + '\n';
      return;
    }
    yield row(['Section', 'Item', 'Value']);
    yield row(['Notice', 'Disclaimer', NOT_ADVICE]);
    if (report.unverified)
      yield row([
        'Notice',
        'Rates',
        'Unverified rates: not yet checked against the official publications',
      ]);
    yield row(['Year', 'Tax_Year', year]);
    yield row(['Year', 'Country', report.country]);
    yield row(['Year', 'Region', report.region]);
    yield row(['Year', 'Set_Aside_Rate_Pct', report.set_aside_bp / 100]);
    if (!report.supported) {
      yield row(['Notice', 'Estimate', report.notices[0]]);
      return;
    }
    const inc = report.income;
    if (inc) {
      yield row(['Income', 'Gross', money(inc.gross_cents)]);
      yield row(['Income', 'Tips', money(inc.tips_cents)]);
      yield row(['Income', 'Bonus', money(inc.bonus_cents)]);
      // Plan 22: only when entered, so today's files are unchanged. Fees and withheld tax are
      // amounts taken, written above zero as on the OECD platform statement.
      if (inc.fees_cents) yield row(['Income', 'Platform_Fees_Taken', money(-inc.fees_cents)]);
      if (inc.adjustments_cents) yield row(['Income', 'Adjustments', money(inc.adjustments_cents)]);
      if (inc.tax_withheld_cents)
        yield row(['Income', 'Tax_Withheld_By_Platforms', money(-inc.tax_withheld_cents)]);
      for (const p of inc.by_platform)
        yield row(['Income_By_Platform', p.platform, money(p.total_cents)]);
    } else yield row(['Income', 'Total', 'not entered']);
    for (const e of expenses_by_category)
      yield row(['Deductible_Expenses', e.category, money(e.deductible_cents)]);
    for (const v of vehicles) {
      yield row(['Vehicle', `${v.vehicle} method`, v.method]);
      yield row([
        'Mileage_Deduction',
        v.vehicle,
        v.mileage_deduction_cents === null ? '' : money(v.mileage_deduction_cents),
      ]);
    }
    const est = report.estimate;
    if (est) {
      yield row(['Estimate', 'Net_Income', money(est.net_income_cents)]);
      yield row(['Estimate', 'Taxable_Income', money(est.taxable_income_cents)]);
      yield row([
        'Estimate',
        'Pension_Contribution',
        est.cpp_cents === null ? (est.pension_note ?? '') : money(est.cpp_cents),
      ]);
      yield row([
        'Estimate',
        'Pension_Contribution_Second_Band',
        est.cpp2_cents === null ? '' : money(est.cpp2_cents),
      ]);
      yield row(['Estimate', 'Income_Tax_Set_Aside', money(est.income_tax_cents)]);
      yield row(['Estimate', 'Total_Set_Aside', money(est.total_set_aside_cents)]);
      yield row(['Estimate', 'Instalment', money(est.instalment_cents)]);
      if (est.sales_tax) {
        yield row(['Sales_Tax', 'Collected', money(est.sales_tax.collected_cents)]);
        yield row(['Sales_Tax', 'Input_Tax_Credits', money(est.sales_tax.credits_cents)]);
        yield row(['Sales_Tax', 'Owing', money(est.sales_tax.owing_cents)]);
      }
    }
    yield row(['Jar', 'Balance', money(report.jar.balance_cents)]);
    for (const d of report.deadlines) yield row(['Deadline', d.label, d.date]);
  },
};
