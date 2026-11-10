import { describe, expect, test, vi } from 'vitest';
import {
  createLiveAccumulator,
  degToE7,
  gate,
  haversineDm,
  MAX_SPEED_DMPS,
  measureDistance,
  minMoveDm,
  MIN_MOVE_DM,
  normalize,
  processShift,
  qualify,
  type Fix,
} from '../src/index';
import { goldenInputs } from './support/goldenShift';
import { seeded } from './support/rides';
import { SCENARIOS } from './support/scenarios';

const T0 = 1_700_000_000_000;
const END = T0 + 3_600_000;
// One degree of arc on a 6,371,000 m sphere.
const DEG_M = (6_371_000 * Math.PI) / 180;

let n = 0;
const at = (latDeg: number, lonDeg: number, tS: number, accuracyM = 5): Fix => ({
  seq: ++n,
  recordedAt: T0 + tS * 1000,
  latE7: degToE7(latDeg),
  lonE7: degToE7(lonDeg),
  accuracyM,
});

// A northbound line: `metres` per step along a meridian, one fix per `stepS` seconds.
function line(steps: number, metres: number, stepS: number): Fix[] {
  return Array.from({ length: steps + 1 }, (_, i) => at(43 + (i * metres) / DEG_M, -79, i * stepS));
}

describe('haversine', () => {
  test('one degree of latitude is 111,194.9 m', () => {
    expect(haversineDm(0, 0, 10_000_000, 0)).toBe(Math.round(DEG_M * 10));
  });
  test('zero distance and symmetry', () => {
    expect(haversineDm(1, 2, 1, 2)).toBe(0);
    expect(haversineDm(430_000_000, -790_000_000, 431_000_000, -789_000_000)).toBe(
      haversineDm(431_000_000, -789_000_000, 430_000_000, -790_000_000),
    );
  });
});

describe('gate', () => {
  test('straight line of 10 x 100 m is 1000 m', () => {
    const r = measureDistance(line(10, 100, 10), T0, END);
    expect(r.distanceM).toBe(1000);
    expect(r.accepted).toHaveLength(11);
  });

  test('closed loop returns near its start but counts the full perimeter', () => {
    // Square of 500 m sides: N, E, S, W.
    const dLat = 500 / DEG_M;
    const dLon = 500 / (DEG_M * Math.cos((43 * Math.PI) / 180));
    const pts = [
      [43, -79],
      [43 + dLat, -79],
      [43 + dLat, -79 + dLon],
      [43, -79 + dLon],
      [43, -79],
    ] as const;
    const fixes = pts.map(([la, lo], i) => at(la, lo, i * 60));
    expect(measureDistance(fixes, T0, END).distanceM).toBe(2000);
  });

  test('a single jitter spike is excluded and does not move the anchor', () => {
    const f = line(4, 100, 10);
    const spike = at(43 + 5000 / DEG_M, -79, 15); // 5 km in 5 s
    const withSpike = [...f.slice(0, 2), spike, ...f.slice(2)];
    const r = measureDistance(withSpike, T0, END);
    expect(r.stats.speed_spike).toBe(1);
    expect(r.distanceM).toBe(400);
  });

  test('the 20 m gate: 19.9 m dropped, 20 m accepted, creep accumulates on the anchor', () => {
    const a = at(43, -79, 0);
    const near = at(43 + 19.9 / DEG_M, -79, 10);
    const exact = at(43 + 20 / DEG_M, -79, 20);
    expect(gate([a, near]).stats.within_gate).toBe(1);
    expect(gate([a, near]).distanceDm).toBe(0);
    expect(gate([a, exact]).distanceM).toBe(20);
    // 10 m creeps: the 2nd is 20 m from the anchor and counts once.
    const creep = [0, 1, 2, 3, 4].map((i) => at(43 + (i * 10) / DEG_M, -79, i * 10));
    const r = gate(creep);
    expect(r.stats.within_gate).toBe(2);
    expect(r.distanceM).toBe(40);
  });

  test('speed bound: exactly 42 m/s passes, just above is a spike', () => {
    const a = at(43, -79, 0);
    expect(gate([a, at(43 + 420 / DEG_M, -79, 10)]).stats.speed_spike).toBe(0);
    expect(gate([a, at(43 + 421 / DEG_M, -79, 10)]).stats.speed_spike).toBe(1);
  });

  test('non-positive time is dropped', () => {
    const a = at(43, -79, 10);
    const b = { ...at(43.01, -79, 10), seq: 99 };
    const r = gate([a, b]);
    expect(r.stats.non_positive_dt).toBe(1);
    expect(r.distanceDm).toBe(0);
  });

  test('empty and single-fix input', () => {
    expect(measureDistance([], T0, END).distanceM).toBe(0);
    expect(measureDistance([at(43, -79, 0)], T0, END).distanceM).toBe(0);
  });

  test('low-accuracy fixes never become the anchor', () => {
    const f = line(3, 100, 10);
    const bad = at(43.5, -79, 15, 51);
    expect(measureDistance([f[0]!, bad, f[1]!, f[2]!, f[3]!], T0, END).distanceM).toBe(300);
  });
});

/** Stage 3 as it was up to algorithmVersion 3: a fixed 20 m minimum move. Reference only. */
function oldGateDm(fixes: readonly Fix[]): number {
  let anchor: Fix | null = null;
  let total = 0;
  for (const f of fixes) {
    if (anchor === null) {
      anchor = f;
      continue;
    }
    const dtMs = f.recordedAt - anchor.recordedAt;
    if (dtMs <= 0) continue;
    const d = haversineDm(anchor.latE7, anchor.lonE7, f.latE7, f.lonE7);
    if (d * 1000 > MAX_SPEED_DMPS * dtMs || d < MIN_MOVE_DM) continue;
    total += d;
    anchor = f;
  }
  return total;
}
const oldDistanceDm = (fixes: readonly Fix[]) => oldGateDm(qualify(normalize(fixes, T0, END)));

// Metres east and north of (43, -79) to a fix, `tS` seconds in.
const COS43 = Math.cos((43 * Math.PI) / 180);
const local = (northM: number, eastM: number, tS: number, accuracyM: number): Fix =>
  at(43 + northM / DEG_M, -79 + eastM / (DEG_M * COS43), tS, accuracyM);

// 1 km north with good fixes, 10 minutes parked with poor fixes that wander 20-45 m from where the
// car stopped (each fix's accuracy at least its wander), then 500 m on with good fixes.
function parkedWander(): { all: Fix[]; withoutParked: Fix[] } {
  const rideIn = Array.from({ length: 11 }, (_, i) => local(i * 100, 0, i * 10, 5));
  const parked = Array.from({ length: 60 }, (_, i) => {
    const d = 20 + ((i * 11) % 26); // 20..45 m
    const a = (i * 137 * Math.PI) / 180;
    const acc = Math.min(50, Math.max(30, d + 1 + (i % 5)));
    return local(1000 + d * Math.cos(a), d * Math.sin(a), 100 + (i + 1) * 10, acc);
  });
  const rideOut = Array.from({ length: 5 }, (_, i) => local(1100 + i * 100, 0, 710 + i * 10, 5));
  return { all: [...rideIn, ...parked, ...rideOut], withoutParked: [...rideIn, ...rideOut] };
}

describe('accuracy-aware minimum move (ADR 0006)', () => {
  test('max(20 m, worse accuracy of anchor and fix), in decimetres, integers only', () => {
    const f = (accuracyM: number) => ({ ...at(43, -79, 0), accuracyM });
    expect(minMoveDm(f(5), f(5))).toBe(200);
    expect(minMoveDm(f(20), f(3))).toBe(200);
    expect(minMoveDm(f(21), f(3))).toBe(210);
    expect(minMoveDm(f(3), f(35))).toBe(350);
    expect(minMoveDm(f(45), f(30))).toBe(450);
    expect(minMoveDm(f(50), f(50))).toBe(500);
    expect(minMoveDm(f(0), f(0))).toBe(MIN_MOVE_DM);
    for (let a = 0; a <= 50; a++)
      for (let b = 0; b <= 50; b++) {
        const m = minMoveDm(f(a), f(b));
        expect(Number.isInteger(m) && m >= 200 && m <= 500).toBe(true);
      }
  });

  test('the step uses the anchor accuracy too: a fix 30 m from a 35 m anchor is jitter', () => {
    const a = at(43, -79, 0, 35);
    const near = at(43 + 30 / DEG_M, -79, 10, 5);
    expect(gate([a, near]).stats.within_gate).toBe(1);
    expect(gate([a, at(43 + 36 / DEG_M, -79, 10, 5)]).distanceM).toBe(36);
  });

  test('a parked phone with 30-50 m accuracy wandering 20-45 m adds no distance', () => {
    const { all, withoutParked } = parkedWander();
    const r = measureDistance(all, T0, END);
    expect(r.distanceDm).toBe(measureDistance(withoutParked, T0, END).distanceDm);
    expect(r.distanceM).toBe(1500);
    expect(r.stats.within_gate).toBe(60);
    // The old fixed 20 m rule counted the wander as driving.
    expect(oldDistanceDm(all) - r.distanceDm).toBeGreaterThan(5_000);
  });

  test('a slow ride with poor accuracy still counts its full chord distance', () => {
    // 2 m/s, a fix every 10 s (20 m apart), accuracy 35-45 m: 1180 m north, then 400 m east.
    const north = Array.from({ length: 60 }, (_, i) => local(i * 20, 0, i * 10, 35 + (i % 11)));
    const east = Array.from({ length: 20 }, (_, i) =>
      local(1180, (i + 1) * 20, 600 + i * 10, 40 + (i % 6)),
    );
    const fixes = [...north, ...east];
    const r = measureDistance(fixes, T0, END);
    const old = oldDistanceDm(fixes);
    expect(old).toBe(15_800); // exact positions: the old rule counted every 20 m step
    // The larger step only holds back the last stretch before the corner and the end, each
    // shorter than one minimum move (at most 50 m).
    expect(r.distanceDm).toBeLessThanOrEqual(old);
    expect(old - r.distanceDm).toBeLessThan(2 * 500);
    // On the straight part every fix held back is counted later, inside the chord from the same
    // anchor: the full 1180 m.
    expect(measureDistance(north, T0, END).distanceDm).toBe(oldDistanceDm(north));
    // The only shortfall is the last 40 m east, still inside the minimum move when the shift ends.
    expect(r.distanceDm).toBe(15_400);
  });

  test('tracks with every accuracy at 20 m or better give exactly the old totals', () => {
    for (const input of Object.values(goldenInputs())) {
      if (input.fixes.some((f) => f.accuracyM > 20)) continue;
      const g = measureDistance(input.fixes, input.startedAt, input.endedAt);
      expect(g.distanceDm).toBe(
        oldGateDm(qualify(normalize(input.fixes, input.startedAt, input.endedAt))),
      );
    }
    const rand = seeded(42);
    for (let k = 0; k < 200; k++) {
      let y = 0;
      const fixes = Array.from({ length: 80 }, (_, i) => {
        y += rand() * 40;
        return local(y, rand() * 30, i * 10, 1 + Math.floor(rand() * 20));
      });
      expect(measureDistance(fixes, T0, END).distanceDm).toBe(oldDistanceDm(fixes));
    }
  });

  test('a step is never accepted that the old rule would have dropped from the same anchor', () => {
    const rand = seeded(7);
    for (let k = 0; k < 2000; k++) {
      const a = at(43, -79, 0, 1 + Math.floor(rand() * 50));
      const f = at(43 + (rand() * 60) / DEG_M, -79, 10, 1 + Math.floor(rand() * 50));
      const d = haversineDm(a.latE7, a.lonE7, f.latE7, f.lonE7);
      if (gate([a, f]).distanceDm > 0) expect(d).toBeGreaterThanOrEqual(MIN_MOVE_DM);
    }
  });

  test('the golden scenario: parked wander adds nothing, the crawl out counts in full', () => {
    const r = processShift(SCENARIOS.parked_poor_accuracy!());
    expect(r.totals.totalM).toBe(2000);
  });
});

describe('live accumulator', () => {
  test('agrees with the batch result on clean input', () => {
    const fixes = line(30, 80, 10);
    const acc = createLiveAccumulator(T0);
    for (const f of fixes) acc.push(f);
    expect(acc.runningTotalM()).toBe(measureDistance(fixes, T0, END).distanceM);
  });

  test('agrees with batch on a messy in-order ride (spike, creep, duplicate, bad accuracy)', () => {
    const f = line(12, 60, 10);
    const messy = [
      f[0]!,
      f[1]!,
      f[1]!,
      at(44, -79, 25),
      f[2]!,
      at(43, -79.5, 28, 80),
      ...f.slice(3),
    ];
    const acc = createLiveAccumulator(T0);
    for (const x of messy) acc.push(x);
    expect(acc.runningTotalM()).toBe(measureDistance(messy, T0, END).distanceM);
  });

  test('agrees with batch on poor accuracy: parked wander and a slow ride', () => {
    const { all } = parkedWander();
    const slow = Array.from({ length: 40 }, (_, i) =>
      local(1500 + i * 15, 0, 760 + i * 10, 30 + (i % 21)),
    );
    const fixes = [...all, ...slow];
    const acc = createLiveAccumulator(T0);
    for (const f of fixes) acc.push(f);
    expect(acc.runningTotalM()).toBe(measureDistance(fixes, T0, END).distanceM);
    const scenario = SCENARIOS.parked_poor_accuracy!();
    const live = createLiveAccumulator(scenario.startedAt);
    for (const f of scenario.fixes) live.push(f);
    expect(live.runningTotalM()).toBe(processShift(scenario).totals.totalM);
  });

  test('does not use the clock', () => {
    const spy = vi.spyOn(Date, 'now');
    const acc = createLiveAccumulator(T0);
    for (const f of line(5, 100, 10)) acc.push(f);
    acc.runningTotalM();
    measureDistance(line(5, 100, 10), T0, END);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
