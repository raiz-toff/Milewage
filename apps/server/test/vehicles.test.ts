import { afterEach, beforeEach, expect, test } from 'vitest';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
const ids = async (url: string) => (await send('GET', url)).json().map((v: { id: number }) => v.id);

test('create, list, rename and archive; vehicles are never deleted', async () => {
  const made = await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  expect([made.statusCode, made.json()]).toEqual([
    201,
    { id: 1, name: 'Civic', kind: 'car', created_at: h.clock.t, archived_at: null },
  ]);
  await send('POST', '/vehicles', { name: 'Vespa', kind: 'motorcycle' });
  const renamed = await send('PATCH', '/vehicles/1', { name: 'Honda', kind: 'van' });
  expect(renamed.json()).toMatchObject({ name: 'Honda', kind: 'van' });

  const archivedAt = h.clock.t;
  await send('PATCH', '/vehicles/1', { archived: true });
  h.clock.t += 1000;
  const again = await send('PATCH', '/vehicles/1', { archived: true });
  expect(again.json().archived_at).toBe(archivedAt); // the first archive time is kept

  expect(await ids('/vehicles')).toEqual([2]);
  expect(await ids('/vehicles?include_archived=true')).toEqual([1, 2]);
  expect((await send('PATCH', '/vehicles/1', { archived: false })).json().archived_at).toBeNull();
  expect((await send('DELETE', '/vehicles/1')).statusCode).toBe(404);
});

test('validation, lookup and session errors', async () => {
  for (const p of [
    { name: '', kind: 'car' },
    { name: 'Sled', kind: 'boat' },
    { name: 'a', kind: 'car', user_id: 9 },
  ]) {
    expect((await send('POST', '/vehicles', p)).statusCode).toBe(422);
  }
  expect((await send('PATCH', '/vehicles/1', {})).statusCode).toBe(422);
  const missing = await send('PATCH', '/vehicles/99', { name: 'x' });
  expect([missing.statusCode, missing.json().code]).toEqual([404, 'not_found']);
  expect((await h.call('GET', '/vehicles')).json().code).toBe('auth_required');
});
