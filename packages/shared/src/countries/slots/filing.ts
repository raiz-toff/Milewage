// Slot `filing`: when a driver must register for sales tax, and the yearly statement a platform
// sends (plan 21 section 3.6a). Nearest level wins, as a whole. Empty until filled from checked
// sources: an empty slot means no rule is known here.

import { datedProblems } from '../dated';
import { OECD_FIELDS, type OecdField } from '../dimensions';
import type { Dated } from '../types';

/** Above a gross threshold, from the first sale, or the platform collects it for the driver. */
export type SalesTaxRegistration =
  | { kind: 'threshold'; thresholdCents: Dated<number> }
  | { kind: 'from_first_dollar' }
  | { kind: 'platform_collects' };

/** The yearly statement a platform sends the tax office, with the OECD model fields it carries. */
export interface PlatformStatement {
  name: string;
  /** `MM-DD` after the end of the year it covers. */
  due: string;
  oecdFields: readonly OecdField[];
  copyToDriver: boolean;
}

export interface Filing {
  salesTaxRegistration?: SalesTaxRegistration;
  platformStatement?: PlatformStatement;
}

export function filingProblems(f: Filing): string[] {
  const r = f.salesTaxRegistration;
  const s = f.platformStatement;
  return [
    ...(r?.kind === 'threshold' ? datedProblems(r.thresholdCents).map((m) => `filing: ${m}`) : []),
    ...(s && !s.name.trim() ? ['filing: the statement needs a name'] : []),
    ...(s && !/^\d{2}-\d{2}$/.test(s.due) ? ['filing: due must be MM-DD'] : []),
    ...(s?.oecdFields ?? [])
      .filter((x) => !OECD_FIELDS.includes(x))
      .map((x) => `filing: ${x} is not an OECD field`),
  ];
}
