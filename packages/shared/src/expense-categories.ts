// Expense categories (18 section 5.1, two added in 21 section 3.6c): data, not a table. Mapping a category to a T2125 or
// Schedule C line is out of this version because the line numbers are not verified (11 section 4).

export interface ExpenseCategory {
  slug: string;
  label: string;
  default_deductible: boolean;
  /** 0 to 100. */
  default_business_pct: number;
  vehicle_related: boolean;
  /** True when a standard mileage rate already pays for it (an actual-expense claim would count it twice). */
  covered_by_standard_rate: boolean;
}

const c = (
  slug: string,
  label: string,
  o: Partial<Omit<ExpenseCategory, 'slug' | 'label'>> = {},
): ExpenseCategory => ({
  slug,
  label,
  default_deductible: true,
  default_business_pct: 100,
  vehicle_related: false,
  covered_by_standard_rate: false,
  ...o,
});

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  c('fuel', 'Fuel', { vehicle_related: true, covered_by_standard_rate: true }),
  c('maintenance', 'Maintenance and repairs', {
    vehicle_related: true,
    covered_by_standard_rate: true,
  }),
  c('parking', 'Parking', { vehicle_related: true }),
  c('tolls', 'Tolls', { vehicle_related: true }),
  c('insurance', 'Insurance', { vehicle_related: true, covered_by_standard_rate: true }),
  c('licensing', 'Licence and registration', { vehicle_related: true }),
  c('interest', 'Loan interest', { vehicle_related: true }),
  c('leasing', 'Lease payments', { vehicle_related: true }),
  // 21 section 3.6c: short-term rent and instalments towards owning the vehicle. Covered by a
  // standard mileage rate as the IRS treats lease payments (Publication 463). A finance or
  // hire-purchase payment includes the price of the vehicle, so it is not deductible by default.
  c('vehicle_rental', 'Vehicle rental', { vehicle_related: true, covered_by_standard_rate: true }),
  c('vehicle_finance', 'Finance or hire-purchase payments', {
    vehicle_related: true,
    covered_by_standard_rate: true,
    default_deductible: false,
  }),
  c('fees', 'Platform and service fees'),
  c('phone', 'Phone', { default_business_pct: 50 }),
  c('data_plan', 'Data plan', { default_business_pct: 50 }),
  c('wash', 'Car wash', { vehicle_related: true }),
  c('supplies', 'Supplies and gear'),
  c('meals', 'Meals', { default_business_pct: 50 }),
  c('bank_fees', 'Bank fees'),
  c('software', 'Software and apps'),
  c('accounting', 'Accounting and tax help'),
  c('bike_maintenance', 'Bike maintenance', { vehicle_related: true }),
  c('out_of_pocket', 'Out of pocket (not deductible)', {
    default_deductible: false,
    default_business_pct: 0,
  }),
  c('other', 'Other'),
];

export const expenseCategory = (slug: string) => EXPENSE_CATEGORIES.find((x) => x.slug === slug);
