// Integer-only helpers (14 section 9). No floating point decisions leave this file.

export const E7 = 10_000_000; // degrees -> latE7 / lonE7
export const DM_PER_M = 10; // distances are summed in decimetres

/** Round to the nearest integer, halves toward +infinity. Deterministic for any finite input. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** Degrees to an E7 integer. */
export function degToE7(deg: number): number {
  return roundHalfUp(deg * E7);
}

/** E7 integer to degrees (for the haversine and display only). */
export function e7ToDeg(e7: number): number {
  return e7 / E7;
}

/** Integer division rounded to nearest, halves up. `den` must be a positive integer. */
export function divRound(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/** Metres to decimetres (exact). */
export function mToDm(m: number): number {
  return m * DM_PER_M;
}

/** Decimetres to metres, rounded once (14 section 9.1 rule 2). */
export function dmToM(dm: number): number {
  return divRound(dm, DM_PER_M);
}
