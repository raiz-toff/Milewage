import { countryModules, resolvePlace, type ModuleRegistry } from '@milewage/shared';
import {
  createEarningsRepository,
  createExpenseRepository,
  createTaxRepository,
  totalOf,
  type Db,
} from './db';
import type { DriverContexts } from './driver-context';
import { deductibleCents } from './expense-math';
import type { MileageDeduction } from './mileage-deduction';
import { createEarningsPolicy } from './routes/earnings';

export interface TaxReportOptions {
  db: Db;
  drivers: DriverContexts;
  deduction: MileageDeduction;
  registry: ModuleRegistry;
  /** `comma.tax_countries`: countries whose estimate is not hidden. */
  countries: readonly string[];
  override?: 'replace' | 'sum';
}

/**
 * A country's tax pack and the driver's resolved place, if shown. The country's pack decides
 * whether an estimate exists; `comma.tax_countries` can only hide it (plan 21, owner decision Q3).
 */
export function shownTax(
  country: string,
  region: string | null | undefined,
  shown: readonly string[],
) {
  const c = countryModules.get(country);
  return c?.tax && shown.includes(c.code)
    ? { pack: c.tax, place: resolvePlace(c, region) }
    : undefined;
}

/** Everything `GET /tax/{year}` and the `tax_summary` export say, computed at read time (18 section 7.2). */
export function taxReport(o: TaxReportOptions, userId: number, year: number, collectedCents = 0) {
  const driver = o.drivers.of(userId);
  const tax = createTaxRepository(o.db);
  const inputs = tax.year(userId, year);
  const country = driver.country;
  const { pack, place } = shownTax(country, driver.region, o.countries) ?? {};
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const jarEntries = tax.jar(userId, year);
  const balance = jarEntries.reduce((a, e) => a + e.amountCents, 0);
  const base = {
    year,
    country,
    region: driver.region,
    supported: pack !== undefined,
    unverified: pack ? !pack.verified : true,
    set_aside_bp: inputs.setAsideBp,
    sales_tax_registered: inputs.salesTaxRegistered === 1,
    // The names of the sales tax components at the driver's place (plan 21 `salesTax` slot).
    sales_tax_name: place?.data.salesTax?.map((t) => t.label).join(' + ') || null,
  };
  if (!pack || !place) {
    return {
      ...base,
      notices: [`No tax estimate is available for ${country || 'this country'} yet.`],
      income: null,
      deductions: null,
      estimate: null,
      deadlines: [],
      slip_alerts: [],
      jar: { balance_cents: balance, target_cents: null },
    };
  }

  // Income: the effective earnings (typed totals, else labels). None entered means no estimate, not zero.
  const rows = createEarningsRepository(o.db).effective(
    userId,
    from,
    to,
    createEarningsPolicy(o.drivers, o.registry, o.override).options(userId),
  );
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const byPlatform = new Map<string, number>();
  for (const r of rows) byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? 0) + totalOf(r));
  const income =
    rows.length === 0
      ? null
      : {
          gross_cents: sum((r) => r.grossCents),
          tips_cents: sum((r) => r.tipsCents),
          bonus_cents: sum((r) => r.bonusCents),
          // Plan 22: fees are already taken off the total; withheld tax is shown, not yet credited.
          fees_cents: sum((r) => r.feesCents),
          adjustments_cents: sum((r) => r.adjustmentsCents),
          tax_withheld_cents: sum((r) => r.taxWithheldCents),
          total_cents: sum(totalOf),
          by_platform: [...byPlatform].map(([platform, total_cents]) => ({
            platform,
            total_cents,
          })),
        };

  // Deductions: expenses (not the ones a standard rate covers) and the mileage of standard-rate vehicles.
  const expensesOn = o.registry.isEnabled('expenses');
  let expenses = 0;
  let credits = 0;
  let doubleCounted = 0;
  if (expensesOn) {
    for (const e of createExpenseRepository(o.db).between(userId, from, to)) {
      const ded = deductibleCents(e);
      if (o.deduction.doubleCounts(userId, e)) doubleCounted += ded;
      else {
        expenses += ded;
        if (e.deductible === 1) credits += e.taxCreditCents;
      }
    }
  }
  const period = o.deduction.ofPeriod(userId, from, to);
  const mileage = period.cents;

  const est = income
    ? pack.estimate(
        {
          year,
          region: driver.region,
          incomeCents: income.total_cents,
          expensesCents: expenses,
          mileageCents: mileage ?? 0,
          setAsideBp: inputs.setAsideBp,
          salesTaxRegistered: inputs.salesTaxRegistered === 1,
          collectedCents,
          creditCents: credits,
        },
        place,
      )
    : null;
  const slip = pack.slip;
  const slipAlerts = !slip
    ? []
    : [...byPlatform]
        .filter(([, total]) => total > slip.thresholdCents)
        .map(([platform, total]) => ({
          platform,
          total_cents: total,
          threshold_cents: slip.thresholdCents,
          slip: slip.name,
        }));
  return {
    ...base,
    notices: [
      ...(pack.verified
        ? []
        : [
            `Unverified rates: these figures have not been checked against ${pack.checkedAgainst}.`,
          ]),
      'Estimates to bring to an accountant, not tax advice. Nothing here is filed.',
      ...(period.rate === 'yours' || period.rate === 'mixed'
        ? [
            period.rate === 'yours'
              ? 'The mileage deduction uses your mileage rate, not an official rate.'
              : 'The mileage deduction uses the country rate before your mileage rate starts and your rate from then on. Your rate is not an official rate.',
          ]
        : []),
      ...(income
        ? []
        : ['No earnings are entered or labelled for this year, so there is no estimate.']),
    ],
    income,
    deductions: {
      expenses_cents: expensesOn ? expenses : null,
      double_counted_cents: expensesOn ? doubleCounted : null,
      mileage_cents: mileage,
      // The country's rate, your rate, or both by date (ADR 0007); never presented as official when yours.
      mileage_rate: period.rate,
      vehicles: tax
        .vehicleYears(userId, year)
        .map((v) => ({ vehicle_id: v.vehicleId, method: v.method })),
    },
    estimate: est,
    deadlines: pack.deadlines(year, place),
    slip_alerts: slipAlerts,
    jar: {
      balance_cents: balance,
      target_cents: income ? Math.round((income.total_cents * inputs.setAsideBp) / 10_000) : null,
    },
  };
}
export type TaxReport = ReturnType<typeof taxReport>;
