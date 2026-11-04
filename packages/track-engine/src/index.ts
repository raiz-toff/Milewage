export const name = '@milewage/track-engine';
export * from './types';
export * from './ints';
export { algorithmVersion } from './version';
export { normalize, compareFixes, inWindow, WINDOW_BEFORE_MS, WINDOW_AFTER_MS } from './normalize';
export { qualify, isQualified, MAX_ACCURACY_M } from './qualify';
export { haversineDm, EARTH_RADIUS_M } from './haversine';
export { gate, gateStep, measureDistance, MAX_SPEED_DMPS, MIN_MOVE_DM } from './gate';
export type { DropReason, GateStep, GateResult } from './gate';
export { createLiveAccumulator } from './live';
export type { LiveAccumulator } from './live';
export type { Segment, Spike } from './gate';
export {
  detectGaps,
  interruptionFlags,
  clockSkewFlag,
  qualityFlags,
  sortFlags,
  medianMs,
  lastFixEnd,
  isGap,
  GAP_MIN_DT_MS,
  GAP_MIN_CHORD_DM,
  GAP_LARGE_CHORD_DM,
  GAP_LARGE_DT_MS,
  POOR_ACCURACY_SHARE_PCT,
  LOW_FIX_DENSITY_MS,
  CLOCK_SKEW_LIMIT_MS,
} from './gaps';
export { simplifyRoute, ROUTE_TOLERANCE_DM } from './route';
export type { RoutePoint } from './route';
export { inputDigest, canonicalInputText, fnv1a64Hex } from './digest';
export { makeTripKey, wholeShiftTrips, buildTrips, totalsOf, WHOLE_SHIFT_PURPOSE } from './trips';
export type { TripDraft } from './trips';
export { canonicalJson } from './canonical';
export { processShift } from './process';
export { applyEdits, sortEdits } from './edits';
