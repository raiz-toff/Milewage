import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERIODS,
  addDays,
  dateToIso,
  dayOf,
  formatDay,
  isoToDate,
  monthGrid,
  parseDay,
  period,
  periodOffset,
  rangeText,
  startOfDay,
  todayIn,
  weekOf,
} from '../src/days';

afterEach(() => {
  vi.useRealTimers();
});

const rangeOf = (id: string, today: string, weekStart: number) =>
  PERIODS.find((p) => p.id === id)!.range(today, weekStart);

describe("the driver's day", () => {
  it.each([
    // 23:30 in Toronto on 15 March is already the 16th in UTC: the driver's day is the 15th.
    ['2026-03-16T03:30:00Z', 'America/Toronto', '2026-03-15'],
    ['2026-01-16T04:30:00Z', 'America/Toronto', '2026-01-15'], // the same, in winter time (-5)
    ['2026-03-01T03:00:00Z', 'America/Toronto', '2026-02-28'], // still February in Toronto
    ['2026-03-15T23:30:00Z', 'America/Toronto', '2026-03-15'], // 19:30 there: both agree
    ['2026-03-15T23:30:00Z', 'Asia/Tokyo', '2026-03-16'], // east of UTC it is already tomorrow
    ['2026-03-15T23:30:00Z', 'UTC', '2026-03-15'],
    ['2026-12-31T23:30:00Z', 'Pacific/Auckland', '2027-01-01'], // a new year early
  ])('at %s in %s it is %s', (at, zone, day) => {
    expect(dayOf(Date.parse(at), zone)).toBe(day);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    expect(todayIn(zone)).toBe(day);
  });

  it('steps days across month, year and leap-day ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    // A daylight-saving change in the driver's zone does not move a day.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 7)).toBe('2026-03-15');
  });

  it('starts a week on Monday or on Sunday', () => {
    // 15 Jan 2027 is a Friday; the 17th a Sunday.
    expect(weekOf('2027-01-15', 1)).toBe('2027-01-11');
    expect(weekOf('2027-01-15', 0)).toBe('2027-01-10');
    expect(weekOf('2027-01-17', 1)).toBe('2027-01-11');
    expect(weekOf('2027-01-17', 0)).toBe('2027-01-17');
    expect(weekOf('2027-01-11', 1)).toBe('2027-01-11');
    // Across a year end.
    expect(weekOf('2027-01-01', 1)).toBe('2026-12-28');
  });

  it('finds the instant a day begins in a zone, across daylight-saving changes', () => {
    expect(startOfDay('2026-01-01', 'America/Toronto')).toBe(Date.parse('2026-01-01T05:00:00Z'));
    // Toronto changes on 2026-03-08, offset -5 to -4.
    expect(startOfDay('2026-03-09', 'America/Toronto')).toBe(Date.parse('2026-03-09T04:00:00Z'));
    expect(startOfDay('2026-03-09', 'Pacific/Auckland')).toBe(Date.parse('2026-03-08T11:00:00Z'));
    expect(dayOf(startOfDay('2026-11-01', 'America/Toronto'), 'America/Toronto')).toBe(
      '2026-11-01',
    );
  });
});

describe('periods', () => {
  it('a whole week follows the start day; months and years are calendar ones', () => {
    expect(period('week', '2027-01-15', 1)).toEqual({ from: '2027-01-11', to: '2027-01-17' });
    expect(period('week', '2027-01-15', 0, -1)).toEqual({ from: '2027-01-03', to: '2027-01-09' });
    expect(period('month', '2027-01-15', 1, -1)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(period('month', '2028-02-10', 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(period('year', '2027-07-04', 1)).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(period('year', '2027-07-04', 1, -1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('counts the periods from today to a day', () => {
    expect(periodOffset('week', '2027-01-04', '2027-01-15', 1)).toBe(-1);
    expect(periodOffset('week', '2027-01-11', '2027-01-15', 1)).toBe(0);
    expect(periodOffset('week', '2027-01-10', '2027-01-15', 1)).toBe(-1);
    expect(periodOffset('week', '2027-01-10', '2027-01-15', 0)).toBe(0);
    expect(periodOffset('month', '2026-11-30', '2027-01-15', 1)).toBe(-2);
    expect(periodOffset('year', '2024-06-01', '2027-01-15', 1)).toBe(-3);
  });

  it('the dashboard tabs run from the period start up to today', () => {
    expect(rangeOf('today', '2027-01-15', 1)).toEqual({ from: '2027-01-15', to: '2027-01-15' });
    expect(rangeOf('week', '2027-01-15', 1)).toEqual({ from: '2027-01-11', to: '2027-01-15' });
    // A Sunday with weeks starting on Sunday is a week of one day so far.
    expect(rangeOf('week', '2027-01-17', 0)).toEqual({ from: '2027-01-17', to: '2027-01-17' });
    expect(rangeOf('month', '2026-02-28', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(rangeOf('year', '2026-02-28', 1)).toEqual({ from: '2026-01-01', to: '2026-02-28' });
    expect(rangeOf('30d', '2026-03-01', 1)).toEqual({ from: '2026-01-31', to: '2026-03-01' });
  });

  it('a month grid pads to whole weeks and starts on the chosen day', () => {
    const mon = monthGrid(2027, 2, 1); // 1 Feb 2027 is a Monday
    expect(mon[0]![0]).toBe('2027-02-01');
    expect(mon).toHaveLength(4); // 28 days from a Monday: exactly four weeks
    expect(mon.at(-1)!.at(-1)).toBe('2027-02-28');
    const sun = monthGrid(2027, 2, 0);
    expect(sun[0]!.slice(0, 2)).toEqual([null, '2027-02-01']);
    expect(sun.at(-1)!.at(-1)).toBeNull();
    expect(sun.flat().filter(Boolean)).toHaveLength(28);
    // November 2026 starts on a Sunday: six rows with Monday weeks, five with Sunday weeks.
    expect(monthGrid(2026, 11, 1)).toHaveLength(6);
    expect(monthGrid(2026, 11, 0)).toHaveLength(5);
    expect(monthGrid(2026, 11, 0).flat().filter(Boolean).at(-1)).toBe('2026-11-30');
  });

  it('writes a short range in the local order', () => {
    expect(rangeText('2026-11-02', '2026-11-08', 'en-CA')).toBe('Nov 2–8, 2026');
    expect(rangeText('2026-11-02', '2026-11-08', 'en-GB')).toBe('2–8 Nov 2026');
  });
});

describe('typed days', () => {
  it('reads ISO, the locale order and month names, and refuses what is not a day', () => {
    expect(parseDay('2026-11-07', 'en-CA')).toBe('2026-11-07');
    expect(parseDay('Nov 7, 2026', 'en-CA')).toBe('2026-11-07');
    expect(parseDay('7 November 2026', 'en-GB')).toBe('2026-11-07');
    expect(parseDay('sept 3rd 2026', 'en-US')).toBe('2026-09-03');
    expect(parseDay('11/7/2026', 'en-US')).toBe('2026-11-07');
    expect(parseDay('7/11/2026', 'en-GB')).toBe('2026-11-07');
    for (const bad of ['2026-02-30', '11/7/26', 'Nov 2026', 'Foo 7 2026', '', 'tomorrow']) {
      expect(parseDay(bad, 'en-CA')).toBeNull();
    }
  });

  it('formats for the locale and keeps the day across daylight-saving changes', () => {
    expect(formatDay('2026-11-07', 'en-CA')).toBe('Nov 7, 2026');
    expect(formatDay('2026-11-07', 'en-GB')).toBe('7 Nov 2026');
    for (const d of ['2026-03-08', '2026-03-29', '2026-11-01', '2026-01-01', '2026-12-31']) {
      expect(dateToIso(isoToDate(d)!)).toBe(d);
    }
  });
});
