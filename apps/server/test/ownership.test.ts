import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadMigrations, MIGRATIONS_DIR, migrate, openDatabase } from '../src/index';
import { harness, type Harness } from './support';

// 21 section 3.6c: who owns the vehicle. A record only; no tax rule reads it.
let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
});
afterEach(() => h.close());

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });

describe('vehicle ownership', () => {
  test('left out means owned; each value is stored, returned and editable', async () => {
    const plain = await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    expect(plain.json().ownership).toBe('owned');
    for (const ownership of ['financed', 'leased', 'rented']) {
      const res = await send('POST', '/vehicles', { name: ownership, kind: 'car', ownership });
      expect([res.statusCode, res.json().ownership]).toEqual([201, ownership]);
    }
    const edited = await send('PATCH', '/vehicles/1', { ownership: 'rented' });
    expect(edited.json()).toMatchObject({ name: 'Civic', ownership: 'rented' });
    const other = await send('PATCH', '/vehicles/1', { name: 'Civic 2' });
    expect(other.json().ownership).toBe('rented'); // an edit of another field keeps it
    const listed = (await send('GET', '/vehicles')).json() as { ownership: string }[];
    expect(listed.map((v) => v.ownership)).toEqual(['rented', 'financed', 'leased', 'rented']);
  });

  test('unknown values and null are 422', async () => {
    for (const ownership of ['borrowed', 'Owned', null]) {
      const res = await send('POST', '/vehicles', { name: 'x', kind: 'car', ownership });
      expect(res.statusCode, String(ownership)).toBe(422);
    }
    await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    expect((await send('PATCH', '/vehicles/1', { ownership: 'hire' })).statusCode).toBe(422);
  });

  test('the phone sync feed carries the field with the vehicle', async () => {
    await send('POST', '/vehicles', { name: 'Yulu', kind: 'scooter', ownership: 'rented' });
    const { auth } = await h.pair(cookie);
    const feed = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const vehicle = feed.changes.find((c: { entity: string }) => c.entity === 'vehicle');
    expect(vehicle.data).toMatchObject({ name: 'Yulu', ownership: 'rented' });
  });
});

describe('migration core/0010 on a database with vehicles', () => {
  test('existing vehicles become owned; shifts and readings keep their vehicle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-ownership-'));
    const db = openDatabase(join(dir, 'milewage.db'));
    try {
      const all = loadMigrations(MIGRATIONS_DIR);
      migrate(
        db,
        all.filter((m) => !(m.module === 'core' && m.id >= '0010')),
      );
      db.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
        INSERT INTO vehicles (id, user_id, name, kind, make, power, created_at, archived_at)
          VALUES (7, 1, 'Civic', 'car', 'Honda', 'hybrid', 1, NULL), (8, 1, 'Old', 'van', NULL, NULL, 1, 5);
        INSERT INTO shifts (id, user_id, client_id, vehicle_id, status, started_at, local_date, segmenter, updated_at)
          VALUES (1, 1, 'c', 7, 'ended', 1, '2026-01-01', 'stops', 1);
        INSERT INTO odometer_readings (user_id, vehicle_id, shift_id, kind, reading_m, recorded_at) VALUES (1, 7, 1, 'shift_start', 5, 1);`);
      expect(migrate(db, all)).toContain('core/0010_vehicle_ownership');
      expect(
        db.prepare('SELECT id, name, make, power, archived_at, ownership FROM vehicles').all(),
      ).toEqual([
        {
          id: 7,
          name: 'Civic',
          make: 'Honda',
          power: 'hybrid',
          archived_at: null,
          ownership: 'owned',
        },
        { id: 8, name: 'Old', make: null, power: null, archived_at: 5, ownership: 'owned' },
      ]);
      expect(db.prepare('SELECT vehicle_id FROM odometer_readings').pluck().get()).toBe(7);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(() => db.exec("UPDATE vehicles SET ownership = 'borrowed' WHERE id = 7")).toThrow(
        /CHECK/,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
