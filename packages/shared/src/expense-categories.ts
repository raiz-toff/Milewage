// Expense categories (18 section 5.1): data, not a table. Mapping a category to a T2125 or
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
