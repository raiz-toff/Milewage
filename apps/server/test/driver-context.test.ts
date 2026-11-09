import { afterEach, describe, expect, test } from 'vitest';
import { createDriverContexts } from '../src/driver-context';
import { localDate, localInstant } from '../src/time';
import { harness, type Harness } from './support';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

async function owner(enabled: Record<string, boolean> = {}) {
  h = harness(enabled);
  const { cookie } = await h.signUp();
  const web = (method: string, url: string, body?: object) =>
    h!.call(method, url, body, { cookie });
  return { h, web };
}

describe('the stops rule (decision 1.5b): module and setting', () => {
  test.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('module %s, setting %s: stop detection %s', async (module, setting, on) => {
    const { h, web } = await owner();
    await web('PATCH', '/settings', { stops_enabled: setting });
    const drivers = createDriverContexts({
      db: h.db,
      now: () => h.clock.t,
      stopsModule: () => module,
    });
    expect(drivers.of(1).stopsOn).toBe(on);
  });

  test('every reader follows it: the settings flag, a new shift, the stop routes', async () => {
    const { web } = await owner();
    await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    const start = (n: number) =>
      web('POST', '/shifts', {
        client_id: `00000000-0000-4000-8000-00000000000${n}`,
        vehicle_id: 1,
        started_at: h!.clock.t - n * 3_600_000,
      });
    expect((await web('GET', '/settings')).json().modules.stops).toBe(true);
    expect((await start(2)).json().segmenter).toBe('stops');
    await web('POST', '/shifts/1/end', { ended_at: h!.clock.t - 3_600_000 });

    await web('PATCH', '/settings', { stops_enabled: false });
    expect((await web('GET', '/settings')).json().modules.stops).toBe(false);
    expect((await start(1)).json().segmenter).toBe('whole_shift');
    expect((await web('GET', '/shifts/1/stops')).statusCode).toBe(404);
  });

  test('with the module off the setting cannot turn it on', async () => {
    const { web } = await owner({ stops: false });
    await web('PATCH', '/settings', { stops_enabled: true });
    expect((await web('GET', '/settings')).json().modules.stops).toBe(false);
  });
});

describe('fallbacks', () => {
  test('a user without settings has not finished setup; jobs get undefined', async () => {
    h = harness();
    const drivers = createDriverContexts({
      db: h.db,
      now: () => h!.clock.t,
      stopsModule: () => true,
    });
    expect(drivers.owner()).toBeUndefined();
    expect(drivers.find(1)).toBeUndefined();
    expect(() => drivers.of(1)).toThrow(expect.objectContaining({ code: 'setup_incomplete' }));
    await h.signUp();
    expect(drivers.owner()?.userId).toBe(1);
    expect(drivers.of(1).timeZone).toBe('America/Chicago');
  });

  test('the place, the rates and the work kinds come from the stored row', async () => {
    const { h, web } = await owner();
    const drivers = createDriverContexts({
      db: h.db,
      now: () => h.clock.t,
      stopsModule: () => true,
    });
    const us = drivers.of(1);
    expect([us.country, us.region, us.pack?.code, us.unit, us.currency]).toEqual([
      'US',
      null,
      'US',
      'mi',
      'USD',
    ]);
    expect([us.rateSource, us.ownRate, us.weekStart]).toEqual(['official', null, 1]);
    // Your mileage rate is kept but never replaces an official rate (owner decision Q5).
    await web('PATCH', '/settings', {
      own_mileage_rate: { cents_per_unit: 30.5, unit: 'km' },
      week_start: 0,
      region: 'CA',
    });
    const again = drivers.of(1);
    expect([again.rateSource, again.ownRate, again.weekStart, again.region]).toEqual([
      'official',
      { centsPerUnit: 30.5, unit: 'km' },
      0,
      'CA',
    ]);
  });

  test('today and the date of an instant are in the owner zone, not UTC', async () => {
    const { h } = await owner();
    const drivers = createDriverContexts({
      db: h.db,
      now: () => h.clock.t,
      stopsModule: () => true,
    });
    h.clock.t = at('2027-01-15T05:30:00Z'); // 23:30 the evening before in Chicago
    expect(drivers.of(1).today()).toBe('2027-01-14');
    expect(drivers.of(1).dateOf(at('2027-01-15T06:00:00Z'))).toBe('2027-01-15');
    expect(drivers.of(1).instantOf('2027-01-14', 23 * 60 + 30)).toBe(h.clock.t);
  });
});

describe('local time to an instant (RFC 5545 rules at a DST change)', () => {
  test.each([
    ['2027-01-14', '09:30', 'America/Chicago', '2027-01-14T15:30:00.000Z'],
    ['2027-07-14', '09:30', 'America/Chicago', '2027-07-14T14:30:00.000Z'],
    // Spring forward: 02:30 does not exist; it is read with the offset before the change (03:30 CDT).
    ['2027-03-14', '02:30', 'America/Chicago', '2027-03-14T08:30:00.000Z'],
    ['2027-03-14', '03:30', 'America/Chicago', '2027-03-14T08:30:00.000Z'],
    // Fall back: 01:30 happens twice; the first one (CDT) counts.
    ['2027-11-07', '01:30', 'America/Chicago', '2027-11-07T06:30:00.000Z'],
    ['2027-11-07', '02:30', 'America/Chicago', '2027-11-07T08:30:00.000Z'],
    // East of Greenwich the same rules hold (before, the answer depended on the sign of the offset).
    ['2027-03-28', '01:30', 'Europe/London', '2027-03-28T01:30:00.000Z'],
    ['2027-10-31', '01:30', 'Europe/London', '2027-10-31T00:30:00.000Z'],
    ['2027-10-03', '02:30', 'Australia/Sydney', '2027-10-02T16:30:00.000Z'],
    ['2027-04-04', '02:30', 'Australia/Sydney', '2027-04-03T15:30:00.000Z'],
    // A half-hour change.
    ['2027-10-03', '02:15', 'Australia/Lord_Howe', '2027-10-02T15:45:00.000Z'],
    ['2027-01-14', '00:00', 'Asia/Kolkata', '2027-01-13T18:30:00.000Z'],
  ])('%s %s in %s is %s', (date, time, zone, want) => {
    const [hh, mm] = time.split(':').map(Number) as [number, number];
    expect(iso(localInstant(date, hh * 60 + mm, zone))).toBe(want);
  });

  test('every quarter hour of a change day maps back to the same date', () => {
    for (const [date, zone] of [
      ['2027-03-14', 'America/Chicago'],
      ['2027-11-07', 'America/Chicago'],
      ['2027-03-28', 'Europe/London'],
      ['2027-10-31', 'Europe/London'],
    ] as const) {
      for (let m = 0; m < 24 * 60; m += 15) {
        expect(localDate(localInstant(date, m, zone), zone)).toBe(date);
      }
    }
  });
});
