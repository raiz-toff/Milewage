import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  detectStops,
  normalize,
  processShift,
  qualify,
  stopConfidence,
  STOP_MIN_DWELL_MS,
  type Fix,
  type ShiftInput,
} from '../src/index';
import { goldenInputs } from './support/goldenShift';
import { seeded } from './support/rides';
import { Path, SCENARIOS, shift, T0, track } from './support/scenarios';

const key = (atS: number, id = 'scn') => `${id}:${T0 + atS * 1000}:stop`;
const detect = (i: ShiftInput) =>
  detectStops(i.shiftClientId, qualify(normalize(i.fixes, i.startedAt, i.endedAt)), i.startedAt);

describe('stage 5 stop detection', () => {
  test('a delivery run: three stops, the red light is not one', () => {
    const r = processShift(SCENARIOS.delivery_run!());
    expect(r.stops.map((s) => [s.dwellS, s.confidence])).toEqual([
      [300, 'medium'],
      [240, 'medium'],
      [2100, 'high'],
    ]);
    expect(r.stops[0]!.stopKey).toBe(key(200));
    // M6.1 records facts only: no role yet, and the trips are still the whole-shift trip
    expect(r.stops.every((s) => s.estRole === 'none' && s.role === 'none')).toBe(true);
    expect(r.trips).toHaveLength(1);
  });

  test('total_m is identical under both segmenters, and the whole-shift segmenter has no stops', () => {
    for (const [name, input] of Object.entries(goldenInputs())) {
      const a = processShift({ ...input, segmenter: 'stops' });
      const b = processShift({ ...input, segmenter: 'whole_shift' });
      expect(a.totals.totalM, name).toBe(b.totals.totalM);
      expect(b.stops).toEqual([]);
    }
  });

  test('dwell threshold is inclusive: 119 s is no stop, 120 s is a low-confidence stop', () => {
    const dwell = (s: number) => new Path().ride(1000).sleep(s).ride(1000).input();
    expect(processShift(dwell(119)).stops).toEqual([]);
    expect(processShift(dwell(120)).stops.map((s) => s.confidence)).toEqual(['low']);
    expect(STOP_MIN_DWELL_MS).toBe(120_000);
  });

  test('confidence is from dwell only: 120-179 low, 180-599 medium, 600+ high', () => {
    expect([119_999, 120_000, 179_999].map(stopConfidence)).toEqual(['low', 'low', 'low']);
    expect([180_000, 599_999].map(stopConfidence)).toEqual(['medium', 'medium']);
    expect([600_000, 5_000_000].map(stopConfidence)).toEqual(['high', 'high']);
  });

  test('queue creep inside 40 m for 3 minutes is a stop: a false positive the spec admits', () => {
    const r = processShift(SCENARIOS.queue_creep!());
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]!.dwellS).toBe(180);
  });

  test('wake-up rule: a silence then a fix 100 m on counts as the dwell; 200 m on does not', () => {
    const r = processShift(SCENARIOS.wake_up!());
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ dwellS: 600, confidence: 'high' });
    const far = new Path().ride(1500);
    far.t += 600;
    far.y += 200;
    far.rows.push([far.t, far.y]);
    expect(processShift(far.ride(1500).input()).stops).toEqual([]);
  });

  test('merge rule: two dwells 80 m apart are one stop, 150 m apart are two', () => {
    const build = (distM: number) =>
      new Path().ride(1000).wait(60).sleep(80).ride(distM).wait(60).sleep(80).ride(1000).input();
    const one = processShift(build(80)).stops;
    expect(one).toHaveLength(1);
    expect(one[0]!.endedAt - one[0]!.startedAt).toBeGreaterThan(250_000);
    expect(one[0]!.stopKey).toBe(key(100)); // the first dwell's key survives
    expect(processShift(build(150)).stops).toHaveLength(2);
  });

  test('start guard: a wait at the start location is marked guarded; elsewhere it is not', () => {
    const at = detect(SCENARIOS.start_wait!());
    expect(at).toHaveLength(1);
    expect(at[0]!.startGuarded).toBe(true);
    const elsewhere = detect(new Path().ride(1000).sleep(250).ride(1000).input());
    expect(elsewhere[0]!.startGuarded).toBe(false);
  });

  test('stops are read from the qualified fixes: jitter inside the 20 m gate still counts as dwell', () => {
    const r = processShift(SCENARIOS.delivery_run!());
    expect(r.stats.within_gate).toBeGreaterThan(20);
    expect(r.stops).toHaveLength(3);
  });

  test('a gap (tunnel) is not a stop', () => {
    expect(processShift({ ...SCENARIOS.tunnel!(), segmenter: 'stops' }).stops).toEqual([]);
  });

  test('poor-accuracy fixes are ignored by stop detection', () => {
    const bad: Fix[] = track([
      [0, 0, 0, 5],
      [50, 0, 0, 5],
      [200, 0, 0, 80], // would extend the dwell to 200 s if it were used
      [210, 500, 0, 5],
    ]);
    expect(detect(shift(bad, 210, { segmenter: 'stops' }))).toEqual([]);
  });

  test('shuffling and duplicating fixes changes no stop, key or digest', () => {
    for (const name of ['scenario_delivery_run', 'scenario_wake_up']) {
      const input = goldenInputs()[name]!;
      const r = seeded(11);
      const fixes = [...input.fixes, ...input.fixes.slice(0, 20)].sort(() => r() - 0.5);
      const a = processShift(input);
      const b = processShift({ ...input, fixes });
      expect(b.stops).toEqual(a.stops);
      expect(b.inputDigest).toBe(a.inputDigest);
    }
    const input = SCENARIOS.delivery_run!();
    expect(canonicalJson(processShift(input))).toBe(canonicalJson(processShift(input)));
  });

  test('5,000 fixes with many stops still run in under 50 ms', () => {
    const p = new Path();
    for (let i = 0; i < 125; i++) p.ride(1500).wait(100).sleep(200);
    p.ride(1000);
    const input = p.input();
    expect(input.fixes.length).toBeGreaterThan(3000);
    for (let i = 0; i < 3; i++) processShift(input);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      processShift(input);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[4]!).toBeLessThan(50);
  });
});
