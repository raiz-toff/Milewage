// Hand-built scenarios on a local metre grid (north/east of an origin), used for gaps,
// stops and edits. Deterministic: no randomness, no clock.
import { degToE7, type Fix, type ShiftInput } from '../../src/index';

export const T0 = 1_700_000_000_000;
const ORIGIN_LAT = 43.65;
const ORIGIN_LON = -79.38;
const DEG_M = (6_371_000 * Math.PI) / 180;
const COS_LAT = Math.cos((ORIGIN_LAT * Math.PI) / 180);

/** A fix `tS` seconds after T0, `northM` / `eastM` metres from the origin. */
export function fixAt(seq: number, tS: number, northM: number, eastM = 0, accuracyM = 5): Fix {
  return {
    seq,
    recordedAt: T0 + tS * 1000,
    latE7: degToE7(ORIGIN_LAT + northM / DEG_M),
    lonE7: degToE7(ORIGIN_LON + eastM / (DEG_M * COS_LAT)),
    accuracyM,
  };
}

/** Builds fixes from [tS, northM, eastM?, accuracyM?] rows; seq follows row order from 1. */
export function track(rows: readonly (readonly [number, number, number?, number?])[]): Fix[] {
  return rows.map(([t, n, e, a], i) => fixAt(i + 1, t, n, e ?? 0, a ?? 5));
}

/** Riding north at 10 m/s with a fix every 10 s (100 m apart) from `fromS` to `toS`. */
export function ride(fromS: number, toS: number, northAtFrom: number): [number, number][] {
  const rows: [number, number][] = [];
  for (let t = fromS; t <= toS; t += 10) rows.push([t, northAtFrom + (t - fromS) * 10]);
  return rows;
}

export function shift(
  fixes: Fix[],
  endS: number,
  extra: Partial<ShiftInput> = {},
  id = 'scn',
): ShiftInput {
  return {
    shiftClientId: id,
    startedAt: T0,
    endedAt: T0 + endS * 1000,
    fixes,
    segmenter: 'whole_shift',
    ...extra,
  };
}

/** Name -> input. Each one is also a golden fixture of processShift. */
export const SCENARIOS: Record<string, () => ShiftInput> = {
  // 5 minutes of riding, a 3 minute parked wait (GPS asleep: one fix at each end), more riding.
  parked_wait: () => {
    const a = ride(0, 300, 0); // ends at 3000 m
    const b = ride(480, 780, 3000);
    return shift(track([...a, ...b]), 780);
  },
  // A tunnel: 100 s with no fix, 600 m apart. Counted as a chord, flagged, not large.
  tunnel: () => {
    const a = ride(0, 200, 0); // 2000 m
    const b = ride(300, 500, 2600);
    return shift(track([...a, ...b]), 500);
  },
  // Killed app: 12 minutes with no fix, 6 km apart, recovery wrote an interruption.
  killed_app: () => {
    const a = ride(0, 200, 0);
    const b = ride(920, 1100, 8000);
    return shift(track([...a, ...b]), 1100, {
      interruptions: [{ fromMs: T0 + 200_000, toMs: T0 + 900_000 }],
    });
  },
  // Dead battery: fixes stop at 600 s, the shift never ended; the app closes it at the last fix.
  dead_battery: () => {
    const fixes = track(ride(0, 600, 0));
    return shift(fixes, 600, { autoClosed: true });
  },
  // A glitch fix 200 km away after a 3 minute gap: dropped by the 42 m/s rule, flagged.
  gap_spike: () => {
    const a = ride(0, 100, 0);
    const spike: [number, number][] = [[280, 200_000]];
    const b = ride(300, 400, 1500);
    return shift(track([...a, ...spike, ...b]), 400);
  },
};
