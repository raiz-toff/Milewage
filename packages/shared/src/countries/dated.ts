import type { Dated } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The value at a local date `YYYY-MM-DD`: the last one that started on or before it, else null. */
export function valueAt<T>(p: Dated<T>, date: string): T | null {
  let found: T | null = null;
  for (const start of Object.keys(p.values).sort()) {
    if (start > date) break;
    found = p.values[start] ?? null;
  }
  return found;
}

/** Problems with a parameter: bad dates, nothing set, or no final `null` that ends it. */
export function datedProblems(p: Dated<unknown>): string[] {
  const starts = Object.keys(p.values).sort();
  const out: string[] = [];
  if (!p.label || !p.unit) out.push('label and unit are required');
  if (p.reference.length === 0) out.push('a reference is required');
  for (const s of starts) if (!DATE.test(s)) out.push(`bad date ${s}`);
  if (!starts.some((s) => p.values[s] !== null)) out.push('no value is set');
  const last = starts.at(-1);
  if (last === undefined || p.values[last] !== null) out.push('not ended by a final null');
  return out;
}
