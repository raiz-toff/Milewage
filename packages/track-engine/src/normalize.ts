import type { Fix } from './types';

/** Window the server accepts (14 section 5.1; 08 section 5). */
export const WINDOW_BEFORE_MS = 5 * 60_000;
export const WINDOW_AFTER_MS = 10 * 60_000;

/** Total order on fixes: (recordedAt, seq), then content, so any input order gives one output. */
export function compareFixes(a: Fix, b: Fix): number {
  return (
    a.recordedAt - b.recordedAt ||
    a.seq - b.seq ||
    a.latE7 - b.latE7 ||
    a.lonE7 - b.lonE7 ||
    a.accuracyM - b.accuracyM
  );
}

/** True when a fix lies inside the shift window. */
export function inWindow(f: Fix, startedAt: number, endedAt: number): boolean {
  return f.recordedAt >= startedAt - WINDOW_BEFORE_MS && f.recordedAt <= endedAt + WINDOW_AFTER_MS;
}

/**
 * Stage 1: sort by (recordedAt, seq), keep the first occurrence of each seq,
 * drop fixes outside the shift window. Does not mutate the input.
 */
export function normalize(fixes: readonly Fix[], startedAt: number, endedAt: number): Fix[] {
  const sorted = fixes.filter((f) => inWindow(f, startedAt, endedAt)).sort(compareFixes);
  const seen = new Set<number>();
  const out: Fix[] = [];
  for (const f of sorted) {
    if (seen.has(f.seq)) continue;
    seen.add(f.seq);
    out.push(f);
  }
  return out;
}
