import { expect, test } from 'vitest';
import { colors, touchTarget } from '../src/tokens';

test('palette keys match across themes and values are 6-digit hex', () => {
  expect(Object.keys(colors.light)).toEqual(Object.keys(colors.dark));
  for (const theme of Object.values(colors)) {
    for (const value of Object.values(theme)) expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }
});

test('05 section 1.1 dark values and the light accent flip', () => {
  expect(colors.dark.card).toBe('#16161A');
  expect(colors.dark.border).toBe('#2E2E36');
  expect(colors.dark.accent).toBe('#22c55e');
  expect(colors.light.accent).toBe('#15803D');
  expect(touchTarget.primary).toBe(56);
});
