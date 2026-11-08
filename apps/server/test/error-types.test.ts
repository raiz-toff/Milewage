import { afterEach, expect, test } from 'vitest';
import { describeError, errorTypeUri } from '../src/errors';
import { harness, type Harness } from './support';

let h: Harness | undefined;
afterEach(() => h?.close());

test('the type of a problem is a relative URI that ends with its code', async () => {
  h = harness();
  const res = await h.call('GET', '/nope');
  expect(res.json().type).toBe('/api/v1/errors/not_found');
  expect(errorTypeUri('shift_finalized')).toBe('/api/v1/errors/shift_finalized');
});

test('GET /errors/{code} answers without a sign-in, before and after setup is confirmed', async () => {
  h = harness();
  const res = await h.call('GET', '/errors/shift_finalized');
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    code: 'shift_finalized',
    title: 'Shift is finalized',
    status: 409,
    description: expect.stringContaining('finalized'),
  });
  await h.signUpUnconfirmed();
  expect((await h.call('GET', '/errors/setup_incomplete')).statusCode).toBe(200);
});

test('an unknown code is a 404 problem, including names that exist on Object', async () => {
  h = harness();
  for (const code of ['made_up', 'constructor', '__proto__']) {
    const res = await h.call('GET', `/errors/${code}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  }
  expect(describeError('made_up')).toBeNull();
});
