import type { ExpenseRow } from './db';

/** Round half up, in cents (18 section 5.2). Computed at read time, never stored. */
export const deductibleCents = (
  e: Pick<ExpenseRow, 'amountCents' | 'businessPct' | 'deductible'>,
) => (e.deductible === 1 ? Math.floor((e.amountCents * e.businessPct + 50) / 100) : 0);
