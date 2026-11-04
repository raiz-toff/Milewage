import { describe, expect, it } from 'vitest';
import { boundsOf, lineOf, positionAt, speedIn, stepOf, timeAt, toPoints } from '../src/map/route';
import { blankStyle, chooseStyle } from '../src/map/style';

const route = {
  source: 'raw' as const,
  t: [1000, 2000, 4000],
  lat_e7: [450_000_000, 450_010_000, 450_030_000],
  lon_e7: [-750_000_000, -750_020_000, -750_020_000],
  speed_dmps: [0, 100, null] as (number | null)[],
};

describe('route maths', () => {
  it('converts columnar integers to degrees and decimetres per second to m/s', () => {
    const p = toPoints(route);
    expect(p).toHaveLength(3);
    expect(p[1]).toEqual({ t: 2000, lat: 45.001, lon: -75.002, speed: 10 });
    expect(p[2]?.speed).toBeNull();
  });

  it('cuts unequal arrays to the shortest instead of inventing points', () => {
    expect(toPoints({ ...route, t: [1, 2] })).toHaveLength(2);
  });

  it('interpolates position and speed between fixes and clamps outside the shift', () => {
    const p = toPoints(route);
    const mid = positionAt(p, 1500)!;
    expect(mid.lat).toBeCloseTo(45.0005, 9);
    expect(mid.lon).toBeCloseTo(-75.001, 9);
    expect(mid.speed).toBe(5);
    expect(positionAt(p, 0)).toBe(p[0]);
    expect(positionAt(p, 99_999)).toBe(p[2]);
    // the gap between 2000 and 4000 is honest: halfway in time is halfway on the line
    expect(positionAt(p, 3000)!.lat).toBeCloseTo(45.002, 9);
    expect(positionAt(p, 3000)!.speed).toBeNull();
    expect(positionAt([], 5)).toBeNull();
  });

  it('maps slider steps to times and back, ends included', () => {
    const p = toPoints(route);
    expect(timeAt(p, 0, 1000)).toBe(1000);
    expect(timeAt(p, 1000, 1000)).toBe(4000);
    expect(timeAt(p, 500, 1000)).toBe(2500);
    expect(timeAt(p, 5000, 1000)).toBe(4000); // clamped
    expect(timeAt(p, -3, 1000)).toBe(1000);
    for (const s of [0, 1, 250, 777, 1000]) {
      expect(stepOf(p, timeAt(p, s, 1000), 1000)).toBe(s);
    }
    expect(stepOf(toPoints({ ...route, t: [5, 5, 5] }), 5, 1000)).toBe(0); // zero-length route
  });

  it('computes bounds and a longitude-first GeoJSON line', () => {
    const p = toPoints(route);
    expect(boundsOf(p)).toEqual([-75.002, 45, -75, 45.003]);
    expect(boundsOf([])).toBeNull();
    expect(lineOf(p).geometry.coordinates[0]).toEqual([-75, 45]);
  });

  it('shows speed in the driver unit and a dash when unknown', () => {
    expect(speedIn(10, 'km')).toBe('36 km/h');
    expect(speedIn(10, 'mi')).toBe('22 mph');
    expect(speedIn(null, 'km')).toBe('—');
  });
});

describe('map style', () => {
  it('has no sources when no style URL is configured (nothing to download)', () => {
    const s = chooseStyle(undefined, true);
    expect(typeof s).toBe('object');
    expect(s).toEqual(blankStyle(true));
    expect(blankStyle(true).sources).toEqual({});
    expect(chooseStyle('   ', false)).toEqual(blankStyle(false));
  });

  it('uses the configured URL as given', () => {
    expect(chooseStyle(' /tiles/style.json ', true)).toBe('/tiles/style.json');
  });

  it('takes its colours from the shared tokens, per theme', () => {
    const bg = (d: boolean) =>
      (blankStyle(d).layers[0] as { paint: { 'background-color': string } }).paint[
        'background-color'
      ];
    expect(bg(true)).toBe('#16161A');
    expect(bg(false)).toBe('#FCFCFD');
  });
});
