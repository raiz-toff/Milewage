import { countryModules, resolvePlace, type ModuleRegistry } from '@milewage/shared';
import {
  createEarningsRepository,
  createExpenseRepository,
  createProcessingRepository,
  createSettingsRepository,
  createTaxRepository,
  totalOf,
  type Db,
} from './db';
import { deductibleCents, doubleCounts } from './expense-math';
import { createEarningsPolicy } from './routes/earnings';
import { deductionOfShift } from './processing/presenter';

export interface TaxReportOptions {
  db: Db;
  registry: ModuleRegistry;
  /** Countries whose estimate is on (`comma.tax_countries`). */
  countries: readonly string[];
  override?: 'replace' | 'sum';
}

/** Everything `GET /tax/{year}` and the `tax_summary` export say, computed at read time (18 section 7.2). */
export function taxReport(o: TaxReportOptions, userId: number, year: number, collectedCents = 0) {
  const settings = createSettingsRepository(o.db).get(userId);
  const tax = createTaxRepository(o.db);
  const inputs = tax.year(userId, year);
  const country = settings?.country ?? '';
  const known = countryModules.get(country);
  const place = known && resolvePlace(known, settings?.region);
  const pack = place && o.countries.includes(country) ? known?.tax : undefined;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const jarEntries = tax.jar(userId, year);
  const balance = jarEntries.reduce((a, e) => a + e.amountCents, 0);
  const base = {
    year,
    country,
    region: settings?.region ?? null,
    supported: pack !== undefined,
    unverified: pack ? !pack.verified : true,
    set_aside_bp: inputs.setAsideBp,
    sales_tax_registered: inputs.salesTaxRegistered === 1,
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
    createEarningsPolicy(o.db, o.registry, o.override).options(userId),
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
      if (doubleCounts(o.db, userId, e)) doubleCounted += ded;
      else {
        expenses += ded;
        if (e.deductible === 1) credits += e.taxCreditCents;
      }
    }
  }
  const shifts = createProcessingRepository(o.db).shiftsInPeriod(userId, from, to);
  const mileage = shifts
    .map((s) => deductionOfShift(o.db, s))
    .filter((v): v is number => v !== null);
  const mileageCents = mileage.reduce((a, b) => a + b, 0);

  const est = income
    ? pack.estimate(
        {
          year,
          region: settings?.region ?? null,
          incomeCents: income.total_cents,
          expensesCents: expenses,
          mileageCents,
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
      ...(income
        ? []
        : ['No earnings are entered or labelled for this year, so there is no estimate.']),
    ],
    income,
    deductions: {
      expenses_cents: expensesOn ? expenses : null,
      double_counted_cents: expensesOn ? doubleCounted : null,
      mileage_cents: mileage.length === 0 ? null : mileageCents,
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
