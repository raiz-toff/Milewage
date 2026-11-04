import { sortEdits } from './edits';
import type { Fix, ShiftInput } from './types';

// inputDigest (14 section 9.2): 64-bit FNV-1a over a canonical text of the effective input.
// A consistency check, not security. Written with two 32-bit halves (no BigInt), so it is
// fast on Hermes and gives the same bits everywhere.

const PRIME_LO = 0x1b3; // FNV-64 prime is 2^40 + 0x1b3
const TWO32 = 4_294_967_296;

export function fnv1a64Hex(text: string): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  const step = (byte: number): void => {
    lo = (lo ^ byte) >>> 0;
    const p = lo * PRIME_LO; // < 2^41, exact
    const carry = Math.floor(p / TWO32);
    const newLo = p % TWO32;
    // 2^40 * lo contributes (lo << 8) to the high half
    hi = (hi * PRIME_LO + carry + ((lo << 8) >>> 0)) % TWO32;
    lo = newLo;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) step(c);
    else {
      step(c & 0xff);
      step(c >>> 8);
    }
  }
  return hex8(hi) + hex8(lo);
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical text of what the totals, trips and stops depend on. Fixes are the normalized
 * set (stage 1: sorted, de-duplicated, in the window), so a retried upload or a reordered
 * list gives the same digest. Flag-only inputs (autoClosed, clockSkewMs) are not included.
 */
export function canonicalInputText(input: ShiftInput, normalized: readonly Fix[]): string {
  const lines: string[] = [
    `v1`,
    `shift:${input.shiftClientId},${input.startedAt},${input.endedAt}`,
    `segmenter:${input.segmenter}`,
  ];
  for (const f of normalized) {
    lines.push(`f:${f.seq},${f.recordedAt},${f.latE7},${f.lonE7},${f.accuracyM}`);
  }
  const labels = [...(input.stopLabels ?? [])].sort(
    (a, b) => cmp(a.stopKey, b.stopKey) || cmp(a.role, b.role),
  );
  for (const l of labels) lines.push(`l:${l.stopKey},${l.role}`);
  const ints = [...(input.interruptions ?? [])].sort(
    (a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs,
  );
  for (const i of ints) lines.push(`i:${i.fromMs},${i.toMs}`);
  const edits = sortEdits(input.edits ?? []);
  for (const e of edits) lines.push(`e:${e.tripKey},${e.kind ?? ''},${e.purpose ?? ''}`);
  return lines.join('\n');
}

export function inputDigest(input: ShiftInput, normalized: readonly Fix[]): string {
  return fnv1a64Hex(canonicalInputText(input, normalized));
}
