import { expect, test } from 'vitest';
import { median } from './measure-b17.mjs';

test('median of odd and even samples', () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
});
