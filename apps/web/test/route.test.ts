import { describe, expect, it } from 'vitest';
import { boundsOf, lineOf, positionAt, toPoints } from '../src/map/route';
import { segmentOf } from '../src/map/route';
import { OPENFREEMAP, blankStyle, chooseStyle, routeColor } from '../src/map/style';

const route = {
  source: 'raw' as const,
  t: [1000, 2000, 4000],
  lat_e7: [450_000_000, 450_010_000, 450_030_000],
  lon_e7: [-750_000_000, -750_020_000, -750_020_000],
  speed_dmps: [0, 100, null] as (number | null)[],
};

describe('route maths', () => {
  it('converts columnar integers to degrees', () => {
    const p = toPoints(route);
    expect(p).toHaveLength(3);
    expect(p[1]).toEqual({ t: 2000, lat: 45.001, lon: -75.002 });
  });

  it('cuts out the part of the route a trip covers, with its ends on the line', () => {
    const p = toPoints(route);
    const seg = segmentOf(p, 1500, 3000);
    expect(seg.map((x) => x.t)).toEqual([1500, 2000, 3000]);
    expect(seg[2]!.lat).toBeCloseTo(45.002, 9);
    expect(segmentOf(p, 3000, 3000)).toEqual([]);
    expect(segmentOf([], 1, 2)).toEqual([]);
  });

  it('cuts unequal arrays to the shortest instead of inventing points', () => {
    expect(toPoints({ ...route, t: [1, 2] })).toHaveLength(2);
  });

  it('interpolates the position between fixes and clamps outside the shift', () => {
    const p = toPoints(route);
    const mid = positionAt(p, 1500)!;
    expect(mid.lat).toBeCloseTo(45.0005, 9);
    expect(mid.lon).toBeCloseTo(-75.001, 9);
    expect(positionAt(p, 0)).toBe(p[0]);
    expect(positionAt(p, 99_999)).toBe(p[2]);
    // the gap between 2000 and 4000 is honest: halfway in time is halfway on the line
    expect(positionAt(p, 3000)!.lat).toBeCloseTo(45.002, 9);
    expect(positionAt([], 5)).toBeNull();
  });

  it('computes bounds and a longitude-first GeoJSON line', () => {
    const p = toPoints(route);
    expect(boundsOf(p)).toEqual([-75.002, 45, -75, 45.003]);
    expect(boundsOf([])).toBeNull();
    expect(lineOf(p).geometry.coordinates[0]).toEqual([-75, 45]);
  });
});

describe('map style', () => {
  it('uses OpenFreeMap for the theme when no style URL is configured', () => {
    expect(chooseStyle(undefined, true)).toBe(OPENFREEMAP.dark);
    expect(chooseStyle('   ', false)).toBe(OPENFREEMAP.light);
  });

  it('draws on a blank background with nothing to download when set to none', () => {
    const s = chooseStyle('none', true);
    expect(s).toEqual(blankStyle(true));
    expect(blankStyle(true).sources).toEqual({});
  });

  it('uses the configured URL as given', () => {
    expect(chooseStyle(' /tiles/style.json ', true)).toBe('/tiles/style.json');
  });

  it('takes its colours from the Material scheme, per theme', () => {
    const bg = (d: boolean) =>
      (blankStyle(d).layers[0] as { paint: { 'background-color': string } }).paint[
        'background-color'
      ];
    // A step off the card: surface-container-low in light, the Asphalt page in dark.
    expect(bg(true)).toBe('#111416');
    expect(bg(false)).toBe('#f3f3f6');
    // The route is Lane yellow itself in both themes.
    expect(routeColor(true)).toBe('#ffc21f');
    expect(routeColor(false)).toBe('#ffc21f');
  });
});
