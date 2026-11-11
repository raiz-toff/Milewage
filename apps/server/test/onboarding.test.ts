import { afterEach, beforeEach, expect, test } from 'vitest';
import { countryModules, gbCountry } from '@milewage/shared';
import { harness, type Harness } from './support';

// Plan 23 section 4.3: work_kinds, and the dashboard's setup steps (setup_done). YY is a
// user-assigned ISO code standing for a country whose data covers two kinds of work.
countryModules.register({ ...gbCountry, code: 'YY', places: [], work: ['delivery', 'moto_taxi'] });

let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

test('a new owner has the only kind of work Canada offers', async () => {
  // Canada offers only delivery: that is the answer, without asking (plan 23 rule 1).
  const prefs = (await web('GET', '/settings')).json();
  expect(prefs.work_kinds).toEqual(['delivery']);
  expect(prefs).not.toHaveProperty('onboarded_at');
});

test("work kinds are checked against the country's list; a new country drops the others", async () => {
  const bad = await web('PATCH', '/settings', { work_kinds: ['ride_hailing'] });
  expect(bad.statusCode).toBe(422);
  expect(bad.json().errors).toEqual([{ path: '/work_kinds', message: 'must be among delivery' }]);
  expect((await web('PATCH', '/settings', { work_kinds: ['taxi'] })).statusCode).toBe(422);

  // Two kinds offered: nothing is chosen for the driver until they answer.
  const yy = await web('PATCH', '/settings', { country: 'YY' });
  expect(yy.json().work_kinds).toEqual([]);
  const both = await web('PATCH', '/settings', { work_kinds: ['moto_taxi', 'delivery'] });
  expect(both.json().work_kinds).toEqual(['moto_taxi', 'delivery']);
  // Back to Canada: moto_taxi is not offered there and is dropped from the stored list.
  await web('PATCH', '/settings', { country: 'CA' });
  const row = h.db.prepare('SELECT work_kinds FROM settings').pluck().get();
  expect(JSON.parse(row as string)).toEqual(['delivery']);
});

test('countries list the kinds of work their data covers', async () => {
  const list = (await h.call('GET', '/countries')).json() as { code: string; work: string[] }[];
  expect(list.find((c) => c.code === 'CA')?.work).toEqual(['delivery']);
});

test('setup steps stay done once listed', async () => {
  expect((await web('GET', '/settings')).json().setup_done).toEqual([]);
  await web('PATCH', '/settings', { setup_done: ['phone'] });
  // Adding more keeps what is there; sending a step again does not repeat it.
  const both = await web('PATCH', '/settings', { setup_done: ['backup', 'phone'] });
  expect(both.json().setup_done).toEqual(['phone', 'backup']);
  expect((await web('PATCH', '/settings', { setup_done: [] })).json().setup_done).toEqual([
    'phone',
    'backup',
  ]);
  expect((await web('PATCH', '/settings', { setup_done: ['platforms'] })).statusCode).toBe(422);
  // The setup wizard is gone: asking to run it again is refused like any other unknown field.
  expect((await web('PATCH', '/settings', { onboarded: false })).statusCode).toBe(422);
});
