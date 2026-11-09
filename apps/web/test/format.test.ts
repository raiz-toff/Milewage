import { describe, expect, it } from 'vitest';
import {
  distanceInput,
  formatDistance,
  formatMoney,
  formatOdometer,
  fromMetres,
  minorDigits,
  moneyInput,
  parseDistance,
  parseMoney,
  parseRate,
  rateInput,
  toMetres,
} from '../src/format';

const plain = (s: string) => s.replace(/\s/g, ' ');

describe('money follows the currency minor unit', () => {
  it('reads the places from Intl', () => {
    expect([minorDigits('USD'), minorDigits('JPY'), minorDigits('KWD')]).toEqual([2, 0, 3]);
    expect(minorDigits('not-a-code')).toBe(2);
  });

  it('formats JPY, USD and KWD from stored minor units', () => {
    expect(plain(formatMoney(1250, 'USD'))).toBe('US$12.50');
    expect(plain(formatMoney(1250, 'JPY'))).toMatch(/1,250$/);
    expect(plain(formatMoney(1250, 'KWD'))).toMatch(/1\.250$/);
    expect(formatMoney(null, 'USD')).toBe('not available');
  });

  it('formats negative values', () => {
    expect(plain(formatMoney(-1250, 'USD'))).toMatch(/^-.*12\.50$/);
    expect(plain(formatMoney(-1250, 'JPY'))).toMatch(/^-.*1,250$/);
    expect(plain(formatMoney(-1250, 'KWD'))).toMatch(/^-.*1\.250$/);
  });

  it('parses a typed amount to minor units', () => {
    expect([parseMoney('12.5', 'USD'), parseMoney('12,50', 'USD'), parseMoney('', 'USD')]).toEqual([
      1250, 1250, 0,
    ]);
    expect(parseMoney('1200', 'JPY')).toBe(1200);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
    expect(parseMoney('-3.5', 'USD')).toBe(-350);
    expect(Number.isNaN(parseMoney('abc', 'USD'))).toBe(true);
  });

  it('round-trips a typed amount through the stored value and back to the field', () => {
    for (const [currency, typed] of [
      ['USD', '12.50'],
      ['JPY', '1250'],
      ['KWD', '12.500'],
      ['USD', '-0.07'],
    ] as const) {
      expect(moneyInput(parseMoney(typed, currency), currency)).toBe(typed);
    }
  });

  it('keeps hundredths of a minor unit in a per-distance rate', () => {
    expect(parseRate('0.305', 'USD')).toBe(30.5);
    expect(rateInput(30.5, 'USD')).toBe('0.305');
    expect(parseRate('30.5', 'JPY')).toBe(30.5);
    expect(rateInput(30.5, 'JPY')).toBe('30.5');
    expect(parseRate('0.3', 'KWD')).toBe(300);
    expect(rateInput(300, 'KWD')).toBe('0.3');
  });
});

describe('distance is stored in metres and shown in the driver unit', () => {
  it('converts both ways', () => {
    expect(toMetres(1, 'mi')).toBe(1609);
    expect(toMetres(2, 'mi')).toBe(3219);
    expect(toMetres(12.5, 'km')).toBe(12_500);
    expect(fromMetres(1609.344, 'mi')).toBe(1);
    expect(fromMetres(12_500, 'km')).toBe(12.5);
  });

  it('formats a distance with one decimal, and a dash when it is not computed', () => {
    expect(formatDistance(16_093, 'mi')).toBe('10.0 mi');
    expect(formatDistance(12_480, 'km')).toBe('12.5 km');
    expect(formatDistance(null, 'km')).toBe('—');
  });

  it('formats an odometer value in whole, grouped units', () => {
    expect(formatOdometer(19_866_720, 'mi')).toBe('12,345 mi');
    expect(formatOdometer(12_345_600, 'km')).toBe('12,346 km');
  });

  it('parses a typed distance, thousands commas allowed', () => {
    expect(parseDistance('12,480.5', 'km')).toBe(12_480_500);
    expect(parseDistance(' 1 ', 'mi')).toBe(1609);
    expect(parseDistance('-1', 'km')).toBeNull();
    expect(parseDistance('', 'km')).toBeNull();
    expect(parseDistance('ten', 'km')).toBeNull();
  });

  it('round-trips a typed distance through the stored value and back to the field', () => {
    expect(distanceInput(parseDistance('12480.5', 'km')!, 'km')).toBe('12480.5');
    expect(distanceInput(parseDistance('7756.3', 'mi')!, 'mi')).toBe('7756.3');
    expect(distanceInput(3219, 'mi', 3)).toBe('2');
    expect(distanceInput(100_000, 'km', 3)).toBe('100');
  });
});
