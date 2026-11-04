import { e7ToDeg, roundHalfUp } from './ints';

/** Earth radius in metres, as in Comma and 14 section 9.1 rule 5. */
export const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance between two E7 points, rounded once to whole decimetres.
 * The formula is written out here, not taken from a library (14 section 9.1).
 */
export function haversineDm(
  aLatE7: number,
  aLonE7: number,
  bLatE7: number,
  bLonE7: number,
): number {
  const rad = Math.PI / 180;
  const lat1 = e7ToDeg(aLatE7) * rad;
  const lat2 = e7ToDeg(bLatE7) * rad;
  const dLat = lat2 - lat1;
  const dLon = (e7ToDeg(bLonE7) - e7ToDeg(aLonE7)) * rad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const a = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return roundHalfUp(EARTH_RADIUS_M * c * 10);
}
