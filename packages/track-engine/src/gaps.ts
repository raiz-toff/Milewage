import type { GateResult } from './gate';
import { dmToM } from './ints';
import type { Fix, Flag, ShiftInput } from './types';

// Gap and data-quality flags (14 sections 7, 8, 15). Flags are facts about the data:
// nothing in this file changes a distance.

/**
 * Reading of 14 section 7.1: the time step is the silence before the segment's end fix, i.e.
 * the time since the previous plausible fix, not the whole span since the anchor. Fixes inside
 * the 20 m gate keep the anchor but show the signal was there, so a long rest (GPS asleep, then
 * a jitter fix, then riding) is not a gap, as the spec's intent says.
 * A gap needs a silence over this AND a chord of at least GAP_MIN_CHORD_DM (14 section 7.1). */
export const GAP_MIN_DT_MS = 90_000;
export const GAP_MIN_CHORD_DM = 1_000; // 100 m
/** `gap_large` when the chord is over 5 km or the time step over 10 minutes. */
export const GAP_LARGE_CHORD_DM = 50_000;
export const GAP_LARGE_DT_MS = 600_000;
/** `poor_accuracy_share` above 30% of fixes over the accuracy cut. */
export const POOR_ACCURACY_SHARE_PCT = 30;
/** `low_fix_density` below one accepted fix per 5 minutes of shift. */
export const LOW_FIX_DENSITY_MS = 300_000;
/** `clock_skew` when the median phone-vs-GNSS difference exceeds 2 minutes (14 section 15). */
export const CLOCK_SKEW_LIMIT_MS = 120_000;

function gapDetail(dtMs: number, chordDm: number): string {
  return `dt_s=${Math.floor(dtMs / 1000)},chord_m=${dmToM(chordDm)}`;
}

export function isGap(dtMs: number, chordDm: number): boolean {
  return dtMs > GAP_MIN_DT_MS && chordDm >= GAP_MIN_CHORD_DM;
}

/**
 * Stage 4. Flags accepted segments that crossed a signal gap, and speed spikes dropped
 * across one. The chord is already in the total (stage 3); a gap adds no special case.
 * Returns the flags and the chord decimetres counted across gaps (`stats.gap_m`).
 */
export function detectGaps(g: GateResult): { flags: Flag[]; gapDm: number } {
  const flags: Flag[] = [];
  let gapDm = 0;
  for (const s of g.segments) {
    const dt = s.silenceMs;
    if (!isGap(dt, s.distanceDm)) continue;
    gapDm += s.distanceDm;
    const at = s.from.recordedAt;
    const detail = gapDetail(dt, s.distanceDm);
    flags.push({ code: 'gap_counted', at, detail });
    if (s.distanceDm > GAP_LARGE_CHORD_DM || dt > GAP_LARGE_DT_MS) {
      flags.push({ code: 'gap_large', at, detail });
    }
  }
  for (const sp of g.spikes) {
    const dt = sp.silenceMs;
    if (isGap(dt, sp.distanceDm)) {
      flags.push({
        code: 'gap_dropped',
        at: sp.anchor.recordedAt,
        detail: gapDetail(dt, sp.distanceDm),
      });
    }
  }
  return { flags, gapDm };
}

/** The recovery path's interruption records, copied into flags so the cause is recorded. */
export function interruptionFlags(interruptions: ShiftInput['interruptions']): Flag[] {
  return (interruptions ?? []).map((i) => ({
    code: 'tracking_interrupted' as const,
    at: i.fromMs,
    detail: `to=${i.toMs}`,
  }));
}

/** Median of integer samples (lower middle for an even count). Empty gives 0. */
export function medianMs(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

export function clockSkewFlag(clockSkewMs: number | undefined): Flag[] {
  if (clockSkewMs === undefined || Math.abs(clockSkewMs) <= CLOCK_SKEW_LIMIT_MS) return [];
  return [{ code: 'clock_skew', detail: `median_ms=${clockSkewMs}` }];
}

/** `poor_accuracy_share` and `low_fix_density`. */
export function qualityFlags(c: {
  considered: number; // fixes after stage 1
  lowAccuracy: number; // dropped by stage 2
  accepted: number; // accepted by stage 3
  shiftMs: number;
}): Flag[] {
  const flags: Flag[] = [];
  if (c.lowAccuracy * 100 > c.considered * POOR_ACCURACY_SHARE_PCT) {
    flags.push({ code: 'poor_accuracy_share', detail: `low=${c.lowAccuracy},of=${c.considered}` });
  }
  if (c.shiftMs > 0 && c.accepted * LOW_FIX_DENSITY_MS < c.shiftMs) {
    flags.push({ code: 'low_fix_density', detail: `accepted=${c.accepted}` });
  }
  return flags;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Fixed flag order: (code, time, detail). No unordered iteration anywhere (14 section 9.1). */
export function sortFlags(flags: readonly Flag[]): Flag[] {
  return [...flags].sort(
    (a, b) =>
      cmp(a.code, b.code) || (a.at ?? 0) - (b.at ?? 0) || cmp(a.detail ?? '', b.detail ?? ''),
  );
}

/**
 * Unfinished shift (14 section 7.4): the end the app offers is the time of the last
 * qualified fix at or after the shift start, never "now". Returns null without one.
 * The caller then sets `autoClosed: true` on the ShiftInput.
 */
export function lastFixEnd(fixes: readonly Fix[], startedAt: number): number | null {
  let last: number | null = null;
  for (const f of fixes) {
    if (f.accuracyM > 50 || f.recordedAt < startedAt) continue;
    if (last === null || f.recordedAt > last) last = f.recordedAt;
  }
  return last;
}
