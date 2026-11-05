import type { Fix } from '@milewage/track-engine';

export const SHIFT = '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11';
const STEP_E7 = 4496; // about 50 m of latitude

/** A ride north with a six minute stop in the middle: one stop that flips the estimate. */
export function ride(t0: number): Fix[] {
  const fixes: Fix[] = [];
  let lat = 437_000_000;
  for (let i = 1; i <= 312; i++) {
    const stationary = i > 120 && i <= 192;
    if (!stationary) lat += STEP_E7;
    fixes.push({
      seq: i,
      recordedAt: t0 + i * 5000,
      latE7: lat + (stationary ? (i % 3) * 30 : 0),
      lonE7: -794_000_000,
      accuracyM: 5,
    });
  }
  return fixes;
}
export const toWire = (f: Fix) => ({
  seq: f.seq,
  recorded_at: f.recordedAt,
  lat_e7: f.latE7,
  lon_e7: f.lonE7,
  accuracy_m: f.accuracyM,
});
