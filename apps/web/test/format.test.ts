import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  minorDigits,
  moneyInput,
  parseMoney,
  parseRate,
  rateInput,
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
