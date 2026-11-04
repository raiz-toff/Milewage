import { describe, expect, test } from 'vitest';
import { processShift } from '../src/index';
import {
  DEFAULTS,
  encodePolyline,
  parseRoutePath,
  routeLengthM,
  run,
  sanityCheck,
  toLatLng,
  type CommaShift,
} from './support/comma';
import type { Io } from './support/conformance';
import { goldenInputs } from './support/goldenShift';

// SYNTHETIC data only: the owner's Comma export was not available when this was written.
// Each shift imitates what Comma stores: a 10 m simplified route and the total as `toFixed(2)` km.
function commaLike(name: string, form: 'json' | 'polyline'): CommaShift {
  const r = processShift(goldenInputs()[name]!);
  const pts = toLatLng(r.route);
  return {
    id: name,
    trackedMileage: Number((r.totals.totalM / 1000).toFixed(2)),
    routePath:
      form === 'json'
        ? JSON.stringify(pts.map((p, i) => ({ ...p, timestamp: r.route[i]!.t })))
        : encodePolyline(pts),
  };
}

const names = ['ride_straight', 'ride_grid', 'ride_loop', 'ride_stop_and_go'];

describe('route path parsing', () => {
  test('polyline round trip is within the 1e-5 degree quantization', () => {
    const pts = toLatLng(processShift(goldenInputs().ride_loop!).route);
    const back = parseRoutePath(encodePolyline(pts))!;
    expect(back).toHaveLength(pts.length);
    expect(Math.abs(back[3]!.latitude - pts[3]!.latitude)).toBeLessThanOrEqual(0.000005);
  });

  test('accepts lat/lng and lat/lon key spellings; rejects junk', () => {
    expect(parseRoutePath('[{"lat":1,"lng":2},{"lat":1.001,"lon":2}]')).toHaveLength(2);
    expect(parseRoutePath('[{"nope":1}]')).toBeNull();
    expect(parseRoutePath('[broken')).toBeNull();
    expect(parseRoutePath('')).toBeNull();
    expect(parseRoutePath(null)).toBeNull();
    expect(parseRoutePath('\u0001')).toBeNull();
  });
});

describe('sanity check on synthetic Comma-shaped shifts', () => {
  test.each(['json', 'polyline'] as const)(
    'engine rides agree with their own stored totals (%s)',
    (form) => {
      const rows = sanityCheck(names.map((n) => commaLike(n, form)));
      for (const r of rows) {
        expect(r.status, `${r.id}: ${r.diffPct}%`).toBe('ok');
        expect(r.diffPct).toBeLessThanOrEqual(0.5);
        expect(r.diffPct).toBeGreaterThanOrEqual(-4);
      }
    },
  );

  test('the simplified route is never longer than the accepted path', () => {
    for (const n of names) {
      const r = processShift(goldenInputs()[n]!);
      expect(routeLengthM(toLatLng(r.route))).toBeLessThanOrEqual(r.totals.totalM + 1);
    }
  });

  test('gross errors are caught: inflated total, miles read as km, missing route, tiny shift', () => {
    const s = commaLike('ride_straight', 'json');
    const rows = sanityCheck([
      { ...s, id: 'inflated', trackedMileage: s.trackedMileage * 1.3 },
      { ...s, id: 'miles_read_as_km', trackedMileage: s.trackedMileage / 1.609344 },
      { ...s, id: 'no_route', routePath: null },
      { ...s, id: 'tiny', trackedMileage: 0.4 },
    ]);
    expect(rows.map((r) => r.status)).toEqual(['too_short', 'too_long', 'no_route', 'skipped']);
    const asMiles = sanityCheck([s], { ...DEFAULTS, unit: 'mi' });
    expect(asMiles[0]!.status).toBe('too_short');
  });
});

describe('command line', () => {
  function io(files: Record<string, string>) {
    const out: string[] = [];
    const i: Io = {
      read: (p) => files[p]!,
      write: () => undefined,
      out: (t) => void out.push(t),
    };
    return { i, text: () => out.join('') };
  }

  test('exit 0 with a table when everything is within the limits', () => {
    const m = io({ 'export.json': JSON.stringify(names.map((n) => commaLike(n, 'json'))) });
    expect(run(['export.json'], m.i)).toBe(0);
    expect(m.text()).toContain('ride_loop');
    expect(m.text()).toContain('4 checked, 0 outside');
  });

  test('exit 1 when a shift is outside the limits; options are honoured', () => {
    const bad = { ...commaLike('ride_straight', 'json'), id: 'bad', trackedMileage: 9 };
    const m = io({ 'export.json': JSON.stringify([bad]) });
    expect(run(['export.json'], m.i)).toBe(1);
    expect(run(['export.json', '--max-under-pct', '99'], m.i)).toBe(0);
    expect(run(['--unit', 'mi', 'export.json'], m.i)).toBe(1);
  });

  test('exit 2 without a file or with a non-numeric limit', () => {
    const m = io({});
    expect(run([], m.i)).toBe(2);
    expect(run(['export.json', '--max-over-pct', 'abc'], m.i)).toBe(2);
  });
});
