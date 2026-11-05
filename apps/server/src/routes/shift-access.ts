import { createShiftRepository, type Db, type ShiftRow } from '../db';
import { ProblemError } from '../errors';
import type { Principal } from './util';

const DAY = 24 * 60 * 60 * 1000;
export const refParam = {
  type: 'string',
  pattern: '^([0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$',
};

/**
 * Resolves `{ref}` (numeric id or client UUID) for a principal. A device reads shifts started in the
 * last 14 days or written to by it in that time (08 section 2.2); a web session reads everything.
 */
export function shiftReader(db: Db, now: () => number) {
  const shifts = createShiftRepository(db);
  return (p: Principal, ref: string): ShiftRow => {
    const row = shifts.byRef(p.userId, ref, p.kind === 'device' ? now() - 14 * DAY : undefined);
    if (!row) throw new ProblemError('shift_not_found', 'No such shift.');
    return row;
  };
}
