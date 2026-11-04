import { expect, test } from 'vitest';
import {
  algorithmVersion,
  degToE7,
  divRound,
  dmToM,
  e7ToDeg,
  mToDm,
  roundHalfUp,
} from '../src/index';

test('algorithmVersion is 3 (stop estimate, M6.2)', () => {
  expect(algorithmVersion).toBe(3);
});

test('degrees round-trip through E7', () => {
  expect(degToE7(43.6532)).toBe(436532000);
  expect(degToE7(-79.3832)).toBe(-793832000);
  expect(e7ToDeg(436532000)).toBeCloseTo(43.6532, 9);
});

test('rounding rules: halves go up, decimetres to metres once', () => {
  expect(roundHalfUp(2.5)).toBe(3);
  expect(roundHalfUp(-2.5)).toBe(-2);
  expect(divRound(5, 10)).toBe(1);
  expect(divRound(4, 10)).toBe(0);
  expect(dmToM(14)).toBe(1);
  expect(dmToM(15)).toBe(2);
  expect(mToDm(7)).toBe(70);
});
