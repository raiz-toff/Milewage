import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { shiftCheck, yearCheck } from '../src/exporters/odometer';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let total: number;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

describe('odometer checks (M9.5)', () => {
  test('shift readings against GPS: ok, mismatch, invalid, and blank when something is missing', () => {
    expect(shiftCheck(1000, 13_000, 12_000)).toBe('ok');
    expect(shiftCheck(1000, 13_000, 12_900)).toBe('ok'); // within 10%
    expect(shiftCheck(0, 20_000, 12_000)).toBe('mismatch: odometer 20.0 km; GPS 12.0 km');
    expect(shiftCheck(0, 500, 1_200)).toBe('ok'); // under 1 km apart is never a mismatch
    expect(shiftCheck(5000, 4000, 100)).toMatch(/^invalid/);
    expect(shiftCheck(null, 100, 100)).toBe('');
    expect(shiftCheck(0, 100, null)).toBe('');
  });

  test('year: tracked distance may not exceed the odometer distance', () => {
    expect(yearCheck(0, 30_000_000, 20_000_000)).toBe('ok'); // business and personal use differ
    expect(yearCheck(0, 30_000_000, 30_200_000)).toBe('ok'); // within 1%
    expect(yearCheck(0, 30_000_000, 31_000_000)).toBe(
      'mismatch: tracked 31000.0 km exceeds odometer 30000.0 km',
    );
    expect(yearCheck(null, 1, 1)).toBe('');
    expect(yearCheck(5, 1, 1)).toMatch(/^invalid/);
  });
});

describe('the checks in the shift-level CSV', () => {
  beforeEach(async () => {
    h = harness();
    ({ cookie } = await h.signUp());
    await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    ({ auth } = await h.pair(cookie));
    t0 = h.clock.t;
    const fixes = ride(t0);
    h.clock.t = t0 + 313 * 5000 + 60_000;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.map(toWire) },
      auth,
    );
    await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: t0 + 313 * 5000 }, auth);
    total = (await web('GET', `/shifts/${SHIFT}`)).json().total_m;
  });
  afterEach(() => h.close());

  const csv = async () => {
    const day = (await web('GET', `/shifts/${SHIFT}`)).json().local_date;
    const lines = (await web('GET', `/exports/csv?from=${day}&to=${day}&level=shift`)).body
      .trim()
      .split('\r\n');
    const head = lines[0]!.split(',');
    const cols = lines[1]!.split(',');
    return (name: string) => cols[head.indexOf(name)];
  };
  const reading = (kind: string, m: number, at = h.clock.t) =>
    web('PUT', `/shifts/${SHIFT}/odometer/${kind}`, { reading_m: m, recorded_at: at });
  const yearReading = (kind: string, m: number) =>
    web('POST', '/odometer', { vehicle_id: 1, kind, reading_m: m, recorded_at: h.clock.t });

  test('no readings: blank columns, nothing invented', async () => {
    const get = await csv();
    expect([
      get('Odometer_Start_Miles'),
      get('Odometer_End_Miles'),
      get('Odometer_Check'),
      get('Year_Odometer_Check'),
    ]).toEqual(['', '', '', '']);
  });

  test('matching shift readings are ok; a wrong end reading is flagged and no number is corrected', async () => {
    await reading('shift_start', 10_000_000);
    await reading('shift_end', 10_000_000 + total + 300);
    expect((await csv())('Odometer_Check')).toBe('ok');
    await reading('shift_end', 10_000_000 + total * 3, h.clock.t + 10);
    const get = await csv();
    expect(get('Odometer_Check')).toMatch(/^mismatch: odometer .* km; GPS .* km$/);
    expect(get('Total_Miles')).toBe((Math.round((total / 1609.344) * 100) / 100).toString());
    expect((await web('GET', `/shifts/${SHIFT}`)).json().total_m).toBe(total); // the stored number is untouched
  });

  test('year start and end: tracked distance above the odometer distance is flagged', async () => {
    await yearReading('year_start', 50_000_000);
    await yearReading('year_end', 50_000_000 + Math.floor(total / 2));
    expect((await csv())('Year_Odometer_Check')).toMatch(/^mismatch: tracked .* exceeds odometer/);
    await yearReading('year_end', 50_000_000 + total * 10);
    expect((await csv())('Year_Odometer_Check')).toBe('ok');
  });
});
