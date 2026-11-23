import type { Schemas } from '../api/client';

type Shift = Schemas['Shift'];

/**
 * "Very short" (spec 001 C1): under 2 minutes, under 160 m (0.1 mi) and nothing on it. The server
 * (`processing/shift-checks.ts`) and the phone (`VeryShortShift` in :core) use the same numbers.
 */
export const VERY_SHORT_MS = 120_000;
export const VERY_SHORT_M = 160;

/** What on a shift makes it more than a mistake. */
export interface ShiftContent {
  earnings: boolean;
  costs: boolean;
  manualTrips: boolean;
}

export const isVeryShort = (s: Shift, c: ShiftContent): boolean =>
  s.status !== 'active' &&
  s.ended_at !== null &&
  s.ended_at - s.started_at < VERY_SHORT_MS &&
  (s.total_m ?? 0) < VERY_SHORT_M &&
  !c.earnings &&
  !c.costs &&
  !c.manualTrips;

/** "40 seconds": a very short shift is under 2 minutes, so seconds read best. */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${s} ${s === 1 ? 'second' : 'seconds'}`;
}

/** The review flag the server sets on a running shift with nothing recorded for 12 hours. */
export const isStale = (s: Shift): boolean =>
  s.status === 'active' && !!s.flags?.some((f) => f.code === 'stale_active_shift');

/** The id of the other shift a `shift_overlap` flag names, if the shift has one. */
export function overlapOf(s: Shift): number | null {
  const f = s.flags?.find((x) => x.code === 'shift_overlap');
  const id = Number((f?.detail as { detail?: string | null } | null | undefined)?.detail);
  return Number.isInteger(id) && id > 0 ? id : null;
}
