import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  detectStops,
  normalize,
  processShift,
  qualify,
  stopConfidence,
  STOP_BREAK_DWELL_MS,
  STOP_MIN_DWELL_MS,
  STOP_TOGGLE_DWELL_MS,
  type Fix,
  type ShiftInput,
  type StopLabelInput,
} from '../src/index';
import { goldenInputs } from './support/goldenShift';
import { seeded } from './support/rides';
import { Path, SCENARIOS, shift, T0, track } from './support/scenarios';

const whole = (i: ShiftInput): ShiftInput => ({ ...i, segmenter: 'whole_shift' });
const key = (atS: number, id = 'scn') => `${id}:${T0 + atS * 1000}:stop`;
const stopsOf = (i: ShiftInput) => processShift(i).stops;
const detect = (i: ShiftInput) =>
  detectStops(i.shiftClientId, qualify(normalize(i.fixes, i.startedAt, i.endedAt)), i.startedAt);

describe('stage 5 stop detection', () => {
  test('a delivery run: two real stops, the red light is not one, the break is long_stop', () => {
    const r = processShift(SCENARIOS.delivery_run!());
    expect(r.stops.map((s) => [s.dwellS, s.confidence, s.estRole, s.role])).toEqual([
      [300, 'medium', 'pickup', 'pickup'],
      [240, 'medium', 'dropoff', 'dropoff'],
      [2100, 'high', 'none', 'none'],
    ]);
    expect(r.flags.filter((f) => f.code === 'long_stop')).toHaveLength(1);
    expect(r.stops[0]!.stopKey).toBe(key(200));
  });

  test('the estimated split follows the stops: deadhead, active, deadhead', () => {
    const r = processShift(SCENARIOS.delivery_run!());
    expect(r.trips.map((t) => [t.kind, t.purpose])).toEqual([
      ['deadhead', 'Between deliveries (estimated)'],
      ['active', 'Delivery (estimated)'],
      ['deadhead', 'Between deliveries (estimated)'],
    ]);
    const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(5);
    near(r.totals.activeM, 2000);
    near(r.totals.deadheadM, 4300);
    expect(r.trips.map((t) => t.originalKind)).toEqual(['deadhead', 'active', 'deadhead']);
    expect(r.trips[1]!.tripKey).toBe(`scn:${r.trips[1]!.startedAt}:active`);
  });

  test('total_m is identical under both segmenters', () => {
    for (const [name, input] of Object.entries(goldenInputs())) {
      const a = processShift({ ...input, segmenter: 'stops' }).totals.totalM;
      const b = processShift({ ...input, segmenter: 'whole_shift' }).totals.totalM;
      expect(a, name).toBe(b);
    }
  });

  test('the whole-shift segmenter reports no stops at all', () => {
    expect(processShift(whole(SCENARIOS.delivery_run!())).stops).toEqual([]);
  });

  test('dwell thresholds are inclusive: 119 s is no stop, 120 s is a low stop, 180 s flips', () => {
    const dwell = (s: number) => new Path().ride(1000).sleep(s).ride(1000).input();
    expect(stopsOf(dwell(119))).toEqual([]);
    const low = processShift(dwell(120));
    expect(low.stops.map((s) => s.confidence)).toEqual(['low']);
    expect(low.stops[0]!.estRole).toBe('none');
    expect(low.flags.map((f) => f.code)).toEqual(['no_stops_detected']);
    expect(STOP_MIN_DWELL_MS).toBe(120_000);
    const t179 = processShift(dwell(179));
    expect(t179.stops[0]!.estRole).toBe('none');
    const t180 = processShift(dwell(180));
    expect(t180.stops[0]).toMatchObject({ confidence: 'medium', estRole: 'pickup' });
    expect(STOP_TOGGLE_DWELL_MS).toBe(180_000);
  });

  test('confidence is from dwell only: 120-179 low, 180-599 medium, 600+ high', () => {
    expect([119_999, 120_000, 179_999].map(stopConfidence)).toEqual(['low', 'low', 'low']);
    expect([180_000, 599_999].map(stopConfidence)).toEqual(['medium', 'medium']);
    expect([600_000, 5_000_000].map(stopConfidence)).toEqual(['high', 'high']);
  });

  test('a stop of 30 minutes or more never flips; 29 min 59 s does', () => {
    const at = (s: number) => processShift(new Path().ride(1000).sleep(s).ride(1000).input());
    expect(at(1799).stops[0]!.estRole).toBe('pickup');
    const long = at(1800);
    expect(long.stops[0]).toMatchObject({ estRole: 'none', confidence: 'high' });
    expect(long.flags.map((f) => f.code)).toEqual(['long_stop', 'no_stops_detected']);
    expect(STOP_BREAK_DWELL_MS).toBe(1_800_000);
  });

  test('queue creep inside 40 m for 3 minutes is a false positive the spec admits', () => {
    const r = processShift(SCENARIOS.queue_creep!());
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ dwellS: 180, estRole: 'pickup' });
  });

  test('wake-up rule: a silence then a fix 100 m on counts as the dwell; 200 m on does not', () => {
    const r = processShift(SCENARIOS.wake_up!());
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ dwellS: 600, confidence: 'high', estRole: 'pickup' });
    const far = new Path().ride(1500);
    far.t += 600;
    far.y += 200;
    far.rows.push([far.t, far.y]);
    expect(stopsOf(far.ride(1500).input())).toEqual([]);
  });

  test('merge rule: two dwells 80 m apart are one stop, 150 m apart are two', () => {
    const build = (distM: number) =>
      new Path().ride(1000).wait(60).sleep(80).ride(distM).wait(60).sleep(80).ride(1000).input();
    const one = stopsOf(build(80));
    expect(one).toHaveLength(1);
    expect(one[0]!.endedAt - one[0]!.startedAt).toBeGreaterThan(250_000);
    expect(one[0]!.stopKey).toBe(key(100)); // the first dwell's key survives
    expect(stopsOf(build(150))).toHaveLength(2);
  });

  test('start guard: a 4 minute wait at the start location is a stop but not a pickup', () => {
    const r = processShift(SCENARIOS.start_wait!());
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]).toMatchObject({ confidence: 'medium', estRole: 'none', role: 'none' });
    expect(r.flags.map((f) => f.code)).toContain('no_stops_detected');
    // the same wait away from the start is a pickup
    expect(
      processShift(new Path().ride(1000).sleep(250).ride(1000).input()).stops[0]!.estRole,
    ).toBe('pickup');
  });

  test('a stop at the end of the shift is recorded and cannot cut a trip', () => {
    const r = processShift(new Path().ride(2000).wait(100).sleep(200).input());
    expect(r.stops).toHaveLength(1);
    // the state flips at departure and nothing follows, so the whole ride stays deadhead
    expect(r.trips.map((t) => t.kind)).toEqual(['deadhead']);
    expect(r.stops[0]!.estRole).toBe('pickup');
  });

  test('stops are read from the qualified fixes: jitter inside the 20 m gate still counts as dwell', () => {
    const input = SCENARIOS.delivery_run!();
    const r = processShift(input);
    expect(r.stats.within_gate).toBeGreaterThan(20);
    expect(r.stops.length).toBe(3);
  });

  test('a gap (tunnel) in the middle of a ride is not a stop', () => {
    expect(stopsOf({ ...SCENARIOS.tunnel!(), segmenter: 'stops' })).toEqual([]);
  });

  test('poor-accuracy fixes are ignored by stop detection', () => {
    const bad: Fix[] = track([
      [0, 0, 0, 5],
      [50, 0, 0, 5],
      [200, 0, 0, 80], // would extend the dwell to 200 s if it were used
      [210, 500, 0, 5],
    ]);
    expect(detect(shift(bad, 410, { segmenter: 'stops' }))).toEqual([]);
  });
});

describe('labels', () => {
  const stack = SCENARIOS.stacked_orders!();
  const keys = stopsOf(stack).map((s) => s.stopKey);

  test('unlabelled order stack alternates, so the estimate under-states active miles', () => {
    expect(stopsOf(stack).map((s) => s.estRole)).toEqual([
      'pickup',
      'dropoff',
      'pickup',
      'dropoff',
    ]);
  });

  test('labels pickup, pickup, dropoff, dropoff fix the split and never change total_m', () => {
    const labels: StopLabelInput[] = [
      { stopKey: keys[0]!, role: 'pickup' },
      { stopKey: keys[1]!, role: 'pickup' },
      { stopKey: keys[2]!, role: 'dropoff' },
      { stopKey: keys[3]!, role: 'dropoff' },
    ];
    const plain = processShift(stack);
    const labelled = processShift({ ...stack, stopLabels: labels });
    expect(labelled.totals.totalM).toBe(plain.totals.totalM);
    expect(labelled.totals.activeM).toBeGreaterThan(plain.totals.activeM);
    expect(labelled.stops.map((s) => s.role)).toEqual(['pickup', 'pickup', 'dropoff', 'dropoff']);
    // estRole is what an unlabelled stop would have been in the state in force at that stop
    expect(labelled.stops.map((s) => s.estRole)).toEqual([
      'pickup',
      'dropoff',
      'dropoff',
      'pickup',
    ]);
    // active from the first stop's departure to the third's: the 300 m and 1200 m legs
    expect(Math.abs(labelled.totals.activeM - (300 + 1200))).toBeLessThanOrEqual(5);
    expect(labelled.inputDigest).not.toBe(plain.inputDigest);
  });

  test('other changes nothing; pickup on a low-dwell stop is honoured', () => {
    const other = processShift({
      ...stack,
      stopLabels: keys.map((k) => ({ stopKey: k, role: 'other' as const })),
    });
    expect(other.trips.map((t) => t.purpose)).toEqual(['Business driving']); // whole-shift fallback
    expect(other.flags.map((f) => f.code)).toContain('no_stops_detected');
    const short = new Path().ride(1000).sleep(125).ride(1000).input();
    const k = stopsOf(short)[0]!.stopKey;
    const r = processShift({ ...short, stopLabels: [{ stopKey: k, role: 'pickup' }] });
    expect(r.stops[0]).toMatchObject({ estRole: 'none', role: 'pickup' });
    expect(r.totals.activeM).toBeGreaterThan(900);
  });

  test('a label whose stop is gone is returned as label_orphaned and applied to nothing', () => {
    const r = processShift({ ...stack, stopLabels: [{ stopKey: 'scn:1:stop', role: 'pickup' }] });
    expect(r.flags.find((f) => f.code === 'label_orphaned')?.detail).toBe('scn:1:stop');
    expect(r.stops.map((s) => s.role)).toEqual(processShift(stack).stops.map((s) => s.role));
  });

  test('trip edits survive: the key of an unchanged trip is stable when a label is added elsewhere', () => {
    const base = processShift(stack);
    const withLabel = processShift({
      ...stack,
      stopLabels: [{ stopKey: keys[3]!, role: 'other' }],
    });
    expect(withLabel.trips[0]!.tripKey).toBe(base.trips[0]!.tripKey);
    expect(withLabel.stops.map((s) => s.stopKey)).toEqual(base.stops.map((s) => s.stopKey));
  });

  test('a label moving a flip can orphan a trip edit: reported, not guessed', () => {
    const base = processShift(stack);
    const edit = { tripKey: base.trips[2]!.tripKey, kind: 'personal' as const };
    const relabelled = processShift({
      ...stack,
      stopLabels: [{ stopKey: keys[1]!, role: 'pickup' }],
      edits: [edit],
    });
    const stillThere = relabelled.trips.some((t) => t.tripKey === edit.tripKey);
    expect(relabelled.flags.some((f) => f.code === 'override_orphaned')).toBe(!stillThere);
    expect(relabelled.totals.totalM).toBe(base.totals.totalM);
  });
});

describe('properties with stops', () => {
  test('shuffling and duplicating fixes changes no stop, trip, key or digest', () => {
    for (const name of ['scenario_delivery_run', 'scenario_stacked_orders', 'scenario_wake_up']) {
      const input = goldenInputs()[name]!;
      const r = seeded(11);
      const fixes = [...input.fixes, ...input.fixes.slice(0, 20)].sort(() => r() - 0.5);
      const a = processShift(input);
      const b = processShift({ ...input, fixes });
      expect(b.stops).toEqual(a.stops);
      expect(b.trips).toEqual(a.trips);
      expect(b.inputDigest).toBe(a.inputDigest);
    }
  });

  test('stop and trip output is stable byte for byte across runs', () => {
    const input = SCENARIOS.delivery_run!();
    expect(canonicalJson(processShift(input))).toBe(canonicalJson(processShift(input)));
  });

  test('random stop-and-go: trips sum to total, kinds partition the total, stops never overlap', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = seeded(seed);
      const p = new Path();
      for (let i = 0; i < 12; i++) {
        p.ride(200 + Math.floor(r() * 1500));
        const w = Math.floor(r() * 40) * 10;
        p.wait(Math.min(w, 150)).sleep(Math.floor(r() * 600));
      }
      const res = processShift(p.input());
      expect(res.trips.reduce((s, t) => s + t.distanceM, 0)).toBe(res.totals.totalM);
      expect(res.totals.totalM).toBe(res.totals.activeM + res.totals.deadheadM);
      for (let i = 1; i < res.stops.length; i++) {
        expect(res.stops[i]!.startedAt).toBeGreaterThan(res.stops[i - 1]!.endedAt);
      }
      const whole = processShift({ ...p.input(), segmenter: 'whole_shift' });
      expect(res.totals.totalM).toBe(whole.totals.totalM);
    }
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
