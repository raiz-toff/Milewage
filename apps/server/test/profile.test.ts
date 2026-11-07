import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadMigrations, MIGRATIONS_DIR, migrate, openDatabase } from '../src/index';
import { harness, type Harness } from './support';

// 18 section 4.1: vehicle details, the wider kind set and the profile fields of the settings.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });

describe('vehicle details', () => {
  test('create and edit make, model, year, plate and power; null clears', async () => {
    const made = await send('POST', '/vehicles', {
      name: 'Civic',
      kind: 'car',
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      plate: 'ABC 123',
      power: 'hybrid',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      make: 'Honda',
      year: 2019,
      plate: 'ABC 123',
      power: 'hybrid',
    });
    const bare = (await send('POST', '/vehicles', { name: 'Old', kind: 'van' })).json();
    expect([bare.make, bare.model, bare.year, bare.plate, bare.power]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const cleared = await send('PATCH', '/vehicles/1', { plate: null, power: 'ev', year: 2020 });
    expect(cleared.json()).toMatchObject({ plate: null, power: 'ev', year: 2020, make: 'Honda' });
  });

  test('the new kinds exist; bad years, powers and kinds are 422', async () => {
    for (const kind of ['ebike', 'scooter', 'walking']) {
      expect((await send('POST', '/vehicles', { name: kind, kind })).statusCode).toBe(201);
    }
    for (const bad of [{ year: 1850 }, { year: 2200 }, { power: 'steam' }, { kind: 'boat' }]) {
      const res = await send('POST', '/vehicles', { name: 'x', kind: 'car', ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
  });
});

describe('profile settings', () => {
  test('defaults, then display name, week start and time format are stored', async () => {
    const before = (await send('GET', '/settings')).json();
    expect([before.display_name, before.region, before.week_start, before.time_format]).toEqual([
      null,
      null,
      1,
      '24h',
    ]);
    expect(before.default_vehicle_id).toBeNull();
    const after = await send('PATCH', '/settings', {
      display_name: ' Sam ',
      week_start: 0,
      time_format: '12h',
    });
    expect(after.json()).toMatchObject({ display_name: 'Sam', week_start: 0, time_format: '12h' });
    expect(
      (await send('PATCH', '/settings', { display_name: null })).json().display_name,
    ).toBeNull();
    for (const bad of [{ week_start: 2 }, { time_format: '13h' }]) {
      expect((await send('PATCH', '/settings', bad)).statusCode).toBe(422);
    }
  });

  test('the region must belong to the country pack; a new country clears a foreign region', async () => {
    const wrong = await send('PATCH', '/settings', { region: 'ON' }); // US owner
    expect([wrong.statusCode, wrong.json().errors[0].path]).toEqual([422, '/region']);
    expect((await send('PATCH', '/settings', { region: 'tx' })).json().region).toBe('TX');
    const moved = await send('PATCH', '/settings', { country: 'CA' });
    expect(moved.json().region).toBeNull();
    const both = await send('PATCH', '/settings', { country: 'CA', region: 'on' });
    expect(both.json()).toMatchObject({ country: 'CA', region: 'ON' });
  });

  test('the default vehicle must be active; archiving it clears the default', async () => {
    await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    await send('POST', '/vehicles', { name: 'Vespa', kind: 'motorcycle' });
    expect((await send('PATCH', '/settings', { default_vehicle_id: 9 })).statusCode).toBe(422);
    expect(
      (await send('PATCH', '/settings', { default_vehicle_id: 1 })).json().default_vehicle_id,
    ).toBe(1);
    await send('PATCH', '/vehicles/2', { archived: true });
    expect((await send('GET', '/settings')).json().default_vehicle_id).toBe(1);
    await send('PATCH', '/vehicles/1', { archived: true });
    expect((await send('GET', '/settings')).json().default_vehicle_id).toBeNull();
    expect((await send('PATCH', '/settings', { default_vehicle_id: 2 })).statusCode).toBe(422);
  });
});

describe('eligibility for the automobile rate', () => {
  test('a shift on an ebike, scooter or on foot has no deduction value', async () => {
    await send('PATCH', '/settings', { country: 'CA' });
    for (const [i, kind] of ['car', 'ebike', 'scooter', 'walking'].entries()) {
      await send('POST', '/vehicles', { name: kind, kind });
      const client_id = `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e0${i}`;
      await send('POST', '/shifts', { client_id, vehicle_id: i + 1, started_at: h.clock.t });
      h.db
        .prepare(
          "UPDATE shifts SET status = ?, ended_at = ?, total_m = 10000, local_date = '2026-03-01' WHERE id = ?",
        )
        .run('ended', h.clock.t + 3_600_000, i + 1);
    }
    const shifts = (await send('GET', '/shifts?limit=10')).json().items as {
      vehicle_id: number;
      deduction_cents: number | null;
    }[];
    const by = Object.fromEntries(shifts.map((s) => [s.vehicle_id, s.deduction_cents]));
    expect(by[1]).toBeGreaterThan(0);
    expect([by[2], by[3], by[4]]).toEqual([null, null, null]);
  });
});

describe('the vehicles table rebuild (migration core/0008)', () => {
  test('shifts, readings and the settings keep pointing at their vehicle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-rebuild-'));
    const db = openDatabase(join(dir, 'milewage.db'));
    try {
      const all = loadMigrations(MIGRATIONS_DIR);
      const before = all.filter((m) => !(m.module === 'core' && m.id >= '0008'));
      migrate(db, before);
      db.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
        INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at) VALUES (1, 'CA', 'km', 'CAD', 'UTC', 1);
        INSERT INTO vehicles VALUES (7, 1, 'Civic', 'car', 1, NULL);
        INSERT INTO shifts (id, user_id, client_id, vehicle_id, status, started_at, local_date, segmenter, updated_at)
          VALUES (1, 1, 'c', 7, 'ended', 1, '2026-01-01', 'stops', 1);
        INSERT INTO odometer_readings (user_id, vehicle_id, shift_id, kind, reading_m, recorded_at) VALUES (1, 7, 1, 'shift_start', 5, 1);`);
      expect(migrate(db, all)).toContain('core/0008_profile');
      expect(db.prepare('SELECT name, kind, make FROM vehicles').all()).toEqual([
        { name: 'Civic', kind: 'car', make: null },
      ]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1); // restored after the rebuild
      expect(() =>
        db.exec(
          "INSERT INTO shifts (user_id, client_id, vehicle_id, status, started_at, local_date, segmenter, updated_at) VALUES (1, 'd', 99, 'ended', 1, 'x', 'stops', 1)",
        ),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
