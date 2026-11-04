import type { Fix } from './types';

/** Fixes with a larger horizontal accuracy radius are skipped (14 section 5.2). */
export const MAX_ACCURACY_M = 50;

export function isQualified(f: Fix): boolean {
  return f.accuracyM <= MAX_ACCURACY_M;
}

/** Stage 2: drop `accuracyM > 50`. Order is preserved. */
export function qualify(fixes: readonly Fix[]): Fix[] {
  return fixes.filter(isQualified);
}
