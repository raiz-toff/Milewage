import { expect, test } from 'vitest';
import { name } from '../src/index';

test('placeholder exports its package name', () => {
  expect(name).toBe('@milewage/server');
});
