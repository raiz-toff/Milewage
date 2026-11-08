// Slot `pension`: the public pension plan a self-employed driver pays into. Nearest level wins.
// `null` means "not estimated here" (Quebec has its own plan); the place's notes say why.

import { datedProblems } from '../dated';
import type { Dated } from '../types';

export interface Pension {
  /** Short name, e.g. `CPP`. */
  plan: string;
  /** The plan's figures by name, as the country's tax pack reads them (CA: `ympe`, `selfBp` …). */
  params: Readonly<Record<string, Dated<number>>>;
}

export const pensionProblems = (p: Pension | null): string[] =>
  p === null
    ? []
    : [
        ...(p.plan ? [] : ['pension: plan name is required']),
        ...Object.entries(p.params).flatMap(([k, d]) =>
          datedProblems(d).map((m) => `pension ${k}: ${m}`),
        ),
      ];
