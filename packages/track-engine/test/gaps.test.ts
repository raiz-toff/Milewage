import { describe, expect, test } from 'vitest';
import {
  CLOCK_SKEW_LIMIT_MS,
  clockSkewFlag,
  detectGaps,
  interruptionFlags,
  lastFixEnd,
  measureDistance,
  medianMs,
  qualityFlags,
  sortFlags,
  type ShiftInput,
} from '../src/index';
import { fixAt, ride, SCENARIOS, shift, T0, track } from './support/scenarios';

function gaps(input: ShiftInput) {
  const g = measureDistance(input.fixes, input.startedAt, input.endedAt);
  return { g, ...detectGaps(g) };
}
const codes = (input: ShiftInput) => gaps(input).flags.map((f) => f.code);

describe('stage 4 gaps', () => {
  test('a long rest with GPS asleep is not a gap', () => {
    expect(codes(SCENARIOS.parked_wait!())).toEqual([]);
  });

  test('a tunnel is counted as its chord and flagged, not large', () => {
    const r = gaps(SCENARIOS.tunnel!());
    expect(r.flags).toEqual([
      { code: 'gap_counted', at: T0 + 200_000, detail: 'dt_s=100,chord_m=600' },
    ]);
    // the chord is in the total: 2000 + 600 + 2000
    expect(r.g.distanceM).toBe(4600);
    expect(r.gapDm).toBe(6000);
  });

  test('a killed app over 12 minutes and 6 km is gap_counted and gap_large', () => {
    const r = gaps(SCENARIOS.killed_app!());
    expect(r.flags.map((f) => f.code)).toEqual(['gap_counted', 'gap_large']);
    expect(r.flags[0]!.detail).toBe('dt_s=720,chord_m=6000');
  });

  test('chord over 5 km with a short silence is large; a short chord with a long silence is not a gap', () => {
    // 100 s silence, 5.2 km chord is impossible (42 m/s), so use 130 s: 5.2 km = 40 m/s
    const big = shift(track([...ride(0, 100, 0), [230, 1000 + 5200]]), 230);
    expect(codes(big)).toEqual(['gap_counted', 'gap_large']);
    const small = shift(
      track([
        [0, 0],
        [10, 100],
        [400, 150],
      ]),
      400,
    ); // 50 m after 390 s
    expect(codes(small)).toEqual([]);
  });

  test('a speed spike across a gap is dropped and flagged gap_dropped, and adds no distance', () => {
    const r = gaps(SCENARIOS.gap_spike!());
    expect(r.flags.map((f) => f.code).sort()).toEqual(['gap_counted', 'gap_dropped']);
    expect(r.g.stats.speed_spike).toBe(1);
    expect(r.g.distanceM).toBeLessThan(3000);
  });
});

describe('interruptions and clock', () => {
  test('interruptions become tracking_interrupted flags with the cause recorded', () => {
    const f = interruptionFlags(SCENARIOS.killed_app!().interruptions);
    expect(f).toEqual([
      { code: 'tracking_interrupted', at: T0 + 200_000, detail: `to=${T0 + 900_000}` },
    ]);
    expect(interruptionFlags(undefined)).toEqual([]);
  });

  test('clock skew flags only beyond 2 minutes, either direction', () => {
    expect(clockSkewFlag(undefined)).toEqual([]);
    expect(clockSkewFlag(CLOCK_SKEW_LIMIT_MS)).toEqual([]);
    expect(clockSkewFlag(CLOCK_SKEW_LIMIT_MS + 1)[0]?.code).toBe('clock_skew');
    expect(clockSkewFlag(-300_000)[0]?.detail).toBe('median_ms=-300000');
  });

  test('median of samples ignores outliers', () => {
    expect(medianMs([5, 1_000_000, 3, 4, 2])).toBe(4);
    expect(medianMs([])).toBe(0);
  });
});

describe('unfinished shifts', () => {
  test('dead battery: the offered end is the last fix, not now', () => {
    const input = SCENARIOS.dead_battery!();
    expect(lastFixEnd(input.fixes, input.startedAt)).toBe(T0 + 600_000);
  });

  test('poor fixes and fixes before the start do not set the end; none gives null', () => {
    const fixes = [fixAt(1, -50, 0), fixAt(2, 30, 0), fixAt(3, 900, 0, 0, 80)];
    expect(lastFixEnd(fixes, T0)).toBe(T0 + 30_000);
    expect(lastFixEnd([], T0)).toBeNull();
  });
});

describe('quality flags', () => {
  test('poor accuracy share is strictly above 30%', () => {
    const base = { accepted: 100, shiftMs: 1 };
    expect(qualityFlags({ ...base, considered: 10, lowAccuracy: 3 })).toEqual([]);
    expect(qualityFlags({ ...base, considered: 10, lowAccuracy: 4 })[0]?.code).toBe(
      'poor_accuracy_share',
    );
  });

  test('low fix density below one accepted fix per 5 minutes', () => {
    const hour = 3_600_000;
    expect(qualityFlags({ considered: 12, lowAccuracy: 0, accepted: 12, shiftMs: hour })).toEqual(
      [],
    );
    expect(
      qualityFlags({ considered: 11, lowAccuracy: 0, accepted: 11, shiftMs: hour })[0]?.code,
    ).toBe('low_fix_density');
  });

  test('flags are sorted by (code, time, detail) whatever the input order', () => {
    const a = { code: 'gap_counted' as const, at: 5 };
    const b = { code: 'gap_counted' as const, at: 2 };
    const c = { code: 'clock_skew' as const };
    expect(sortFlags([a, c, b])).toEqual([c, b, a]);
  });
});
