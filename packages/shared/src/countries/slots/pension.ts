// Slot `pension`: the public pension plan a self-employed driver pays into. Nearest level wins.
// `null` means "not estimated here" (Quebec has its own plan); the place's notes say why.

export interface Pension {
  /** Short name shown next to the line, e.g. `CPP`. */
  plan: string;
}

export const pensionProblems = (p: Pension | null): string[] =>
  p === null || p.plan ? [] : ['pension: plan name is required'];
