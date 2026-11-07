import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { countryModules, gbCountry } from '@milewage/shared';
import { loadMigrations, MIGRATIONS_DIR, migrate, openDatabase } from '../src/index';
import { harness, type Harness } from './support';

// Plan 23 section 4.3: onboarded_at and work_kinds. YY is a user-assigned ISO code standing for a
// country whose data covers two kinds of work, so the driver is asked.
countryModules.register({ ...gbCountry, code: 'YY', places: [], work: ['delivery', 'moto_taxi'] });

let h: Harness;
let cookie: string;
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

test('a new owner is not onboarded; finishing sets the time once, running again clears it', async () => {
  // Canada offers only delivery: that is the answer, without asking (plan 23 rule 1).
  expect((await web('GET', '/settings')).json()).toMatchObject({
    onboarded_at: null,
    work_kinds: ['delivery'],
  });
  const done = (await web('PATCH', '/settings', { onboarded: true })).json().onboarded_at;
  expect(done).toBe(h.clock.t);
  h.clock.t += 5000;
  expect((await web('PATCH', '/settings', { onboarded: true })).json().onboarded_at).toBe(done);
  expect((await web('PATCH', '/settings', { onboarded: false })).json().onboarded_at).toBeNull();
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

test('the migration marks owners who already have a vehicle as onboarded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-onboarding-'));
  const db = openDatabase(join(dir, 'milewage.db'));
  try {
    const all = loadMigrations(MIGRATIONS_DIR);
    migrate(
      db,
      all.filter((m) => !(m.module === 'core' && m.id >= '0011')),
    );
    db.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1), (2, 'new', 'x', 1);
      INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at)
        VALUES (1, 'CA', 'km', 'CAD', 'UTC', 1), (2, 'CA', 'km', 'CAD', 'UTC', 1);
      INSERT INTO vehicles (id, user_id, name, kind, created_at, archived_at)
        VALUES (7, 1, 'Civic', 'car', 1, NULL);`);
    expect(migrate(db, all)).toContain('core/0011_onboarding');
    const rows = db.prepare('SELECT user_id, onboarded_at, work_kinds FROM settings').all() as {
      user_id: number;
      onboarded_at: number | null;
      work_kinds: string | null;
    }[];
    expect(rows[0]!.onboarded_at).toBeGreaterThan(Date.UTC(2026, 0, 1));
    expect(rows[1]).toEqual({ user_id: 2, onboarded_at: null, work_kinds: null });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
