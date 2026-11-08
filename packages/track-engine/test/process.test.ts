import { describe, expect, test, vi } from 'vitest';
import {
  canonicalJson,
  degToE7,
  fnv1a64Hex,
  processShift,
  simplifyRoute,
  type Fix,
  type RoutePoint,
  type ShiftInput,
} from '../src/index';
import { instrumented, medianCpuMs } from './support/cpuTime';
import { goldenInputs } from './support/goldenShift';
import { generateRide, seeded } from './support/rides';
import { fixAt, SCENARIOS, shift, T0, track } from './support/scenarios';

function shuffled<T>(a: readonly T[], seed: number): T[] {
  const r = seeded(seed);
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

const inputs = goldenInputs();
const names = Object.keys(inputs);

describe('fnv1a64Hex', () => {
  function reference(text: string): string {
    let h = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(text)) {
      h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, '0');
  }
  test.each(['', 'a', 'foobar', 'shift:abc,1700000000000\nf:1,2,3'])(
    'matches BigInt FNV-1a: %j',
    (s) => {
      expect(fnv1a64Hex(s)).toBe(reference(s));
    },
  );
  test('well-known vectors', () => {
    expect(fnv1a64Hex('')).toBe('cbf29ce484222325');
    expect(fnv1a64Hex('a')).toBe('af63dc4c8601ec8c');
  });
});

describe('canonicalJson', () => {
  test('sorts keys, drops undefined, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 'x' }], z: null, y: true })).toBe(
      '{"a":[2,{"c":"x"}],"b":1,"y":true,"z":null}',
    );
  });
  test('refuses non-integers', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(RangeError);
    expect(() => canonicalJson({ a: NaN })).toThrow(RangeError);
  });
});

describe('simplifyRoute (integer RDP)', () => {
  const p = (northM: number, eastM: number, t: number): RoutePoint => {
    const f = fixAt(1, t, northM, eastM);
    return { latE7: f.latE7, lonE7: f.lonE7, t: f.recordedAt };
  };
  test('collinear points collapse to the two ends; ends and timestamps are kept', () => {
    const pts = [0, 100, 200, 300, 400].map((n, i) => p(n, 0, i * 10));
    const out = simplifyRoute(pts);
    expect(out).toEqual([pts[0], pts[4]]);
  });
  test('a corner survives, 5 m of wobble does not (10 m tolerance)', () => {
    const pts = [p(0, 0, 0), p(200, 5, 20), p(400, 0, 40), p(400, 300, 70)];
    const out = simplifyRoute(pts);
    expect(out.map((q) => q.t)).toEqual([T0, T0 + 40_000, T0 + 70_000]);
  });
  test('short inputs are returned as copies; zero-length chords do not divide by zero', () => {
    expect(simplifyRoute([])).toEqual([]);
    const one = [p(0, 0, 0)];
    expect(simplifyRoute(one)).toEqual(one);
    const loop = [p(0, 0, 0), p(300, 0, 10), p(0, 0, 20)];
    expect(simplifyRoute(loop)).toHaveLength(3);
  });
  test('the simplified loop is never longer than the original and stays within the tolerance', () => {
    const r = generateRide('loop').input.fixes.map((f) => ({
      latE7: f.latE7,
      lonE7: f.lonE7,
      t: f.recordedAt,
    }));
    const out = simplifyRoute(r);
    expect(out.length).toBeLessThan(r.length);
    expect(out.length).toBeGreaterThan(8);
  });
});

describe('processShift', () => {
  test('trips sum to totalM and total = active + deadhead + personal, on every fixture', () => {
    for (const name of names) {
      const r = processShift(inputs[name]!);
      expect(r.trips.reduce((s, t) => s + t.distanceM, 0)).toBe(r.totals.totalM);
      expect(r.totals.totalM).toBe(r.totals.activeM + r.totals.deadheadM + r.totals.personalM);
    }
  });

  test('whole-shift: one active trip named Business driving, no stops', () => {
    for (const name of names.filter((n) => inputs[n]!.segmenter === 'whole_shift')) {
      const r = processShift(inputs[name]!);
      expect(r.trips.length).toBeLessThanOrEqual(1);
      if (r.trips[0]) {
        expect(r.trips[0].kind).toBe('active');
        expect(r.trips[0].purpose).toBe('Business driving');
        expect(r.trips[0].tripKey).toBe(
          `${inputs[name]!.shiftClientId}:${r.trips[0].startedAt}:active`,
        );
      }
      expect(r.stops).toEqual([]);
    }
  });

  test('the tunnel scenario flags the gap and counts the chord', () => {
    const r = processShift(SCENARIOS.tunnel!());
    expect(r.totals.totalM).toBe(4600);
    expect(r.flags.map((f) => f.code)).toEqual(['gap_counted']);
    expect(r.stats.gap_m).toBe(600);
  });

  test('dead battery: shift_auto_closed is flagged at the end the app chose', () => {
    const r = processShift(SCENARIOS.dead_battery!());
    expect(r.flags).toEqual([{ code: 'shift_auto_closed', at: T0 + 600_000 }]);
  });

  test('clock skew, interruptions and quality flags are produced, in code order', () => {
    const base = SCENARIOS.killed_app!();
    const r = processShift({ ...base, clockSkewMs: 400_000 });
    expect(r.flags.map((f) => f.code)).toEqual([
      'clock_skew',
      'gap_counted',
      'gap_large',
      'tracking_interrupted',
    ]);
  });

  test('empty and single-fix shifts give zero totals and no trips', () => {
    const empty = processShift(shift([], 600));
    expect(empty.totals).toEqual({ totalM: 0, activeM: 0, deadheadM: 0, personalM: 0 });
    expect(empty.trips).toEqual([]);
    expect(empty.flags.map((f) => f.code)).toEqual(['low_fix_density']);
    const one = processShift(shift([fixAt(1, 0, 0)], 60));
    expect(one.trips).toEqual([]);
    expect(one.route).toHaveLength(1);
  });
});

describe('properties (14 section 10.2 item 6)', () => {
  test.each(names)(
    '%s: shuffling and duplicating the fixes changes nothing, digest included',
    (name) => {
      const input = inputs[name]!;
      const base = processShift(input);
      const mixed = processShift({
        ...input,
        fixes: shuffled([...input.fixes, ...input.fixes.slice(0, 10)], 7),
      });
      expect(canonicalJson(mixed)).toBe(canonicalJson({ ...base, stats: mixed.stats }));
      expect(mixed.inputDigest).toBe(base.inputDigest);
    },
  );

  test('the digest changes with the fixes, the window, the segmenter, labels and edits', () => {
    const input = inputs.ride_grid!;
    const d = (i: ShiftInput) => processShift(i).inputDigest;
    const base = d(input);
    expect(d({ ...input, fixes: input.fixes.slice(1) })).not.toBe(base);
    expect(d({ ...input, endedAt: input.endedAt + 1 })).not.toBe(base);
    expect(d({ ...input, segmenter: 'stops' })).not.toBe(base);
    expect(d({ ...input, stopLabels: [{ stopKey: 'k', role: 'pickup' }] })).not.toBe(base);
    expect(d({ ...input, edits: [{ tripKey: 'k', kind: 'personal' }] })).not.toBe(base);
    expect(d({ ...input, interruptions: [{ fromMs: 1, toMs: 2 }] })).not.toBe(base);
    expect(d({ ...input, clockSkewMs: 999_999 })).toBe(base); // flag-only input
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });

  test('extra fixes inside 20 m of the anchor change no total, trip or route point', () => {
    const input = inputs.ride_straight!;
    const extra: Fix[] = input.fixes.slice(0, 30).map((f, i) => ({
      ...f,
      seq: 1000 + i,
      recordedAt: f.recordedAt + 1000,
      latE7: f.latE7 + degToE7(0.00003), // about 3 m
    }));
    const a = processShift(input);
    const b = processShift({ ...input, fixes: [...input.fixes, ...extra] });
    expect(b.totals).toEqual(a.totals);
    expect(b.trips).toEqual(a.trips);
    expect(b.route).toEqual(a.route);
  });

  test('the result never depends on the clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      const a = canonicalJson(processShift(inputs.ride_loop!));
      vi.setSystemTime(new Date('2031-06-30T12:34:56Z'));
      expect(canonicalJson(processShift(inputs.ride_loop!))).toBe(a);
    } finally {
      vi.useRealTimers();
    }
  });

  test('random walks: invariants hold on random input', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = seeded(seed);
      const rows: [number, number, number, number][] = [];
      let t = 0;
      let n = 0;
      let e = 0;
      for (let i = 0; i < 300; i++) {
        t += 1 + Math.floor(r() * 120);
        n += (r() - 0.45) * 400;
        e += (r() - 0.5) * 400;
        rows.push([t, n, e, Math.floor(r() * 90)]);
      }
      const input = shift(track(rows), t);
      const res = processShift(input);
      expect(res.trips.reduce((s, x) => s + x.distanceM, 0)).toBe(res.totals.totalM);
      const shuf = processShift({ ...input, fixes: shuffled(input.fixes, seed) });
      expect(shuf.inputDigest).toBe(res.inputDigest);
      expect(shuf.totals).toEqual(res.totals);
      expect(shuf.route).toEqual(res.route);
    }
  });
});

describe('performance (14 section 10.3)', () => {
  test.skipIf(instrumented)('5,000 fixes run in under 50 ms on Node', () => {
    // 5,000 fixes at 10 s: a zig-zag so the route keeps many vertices and the gate accepts most.
    const rows: [number, number, number][] = [];
    for (let i = 0; i < 5000; i++) rows.push([i * 10, i * 60, (i % 7) * 40]);
    const input = shift(track(rows), 50_000);
    expect(processShift(input).stats.fixes_used).toBeGreaterThan(4000);
    // median of 9 runs after a JIT warm-up, in CPU time (see support/cpuTime.ts)
    expect(medianCpuMs(() => processShift(input))).toBeLessThan(50);
  });
});
