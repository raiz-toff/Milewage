import { afterEach, expect, test } from 'vitest';
import { processShift, type Fix, type StopLabelInput } from '@milewage/track-engine';
import { loadMigrations, migrate, MIGRATIONS_DIR } from '../src/index';
import { recalcReport } from '../src/processing/recalc-report';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

// Named places (ADR 0008) were removed on 2026-11-11. A shift recorded while a place labelled one
// of its stops must keep its labels and its active and deadhead split after the upgrade, and after
// it is worked out again: stops migration 0003 turns each place label into the driver's own label.
let h: Harness;
afterEach(() => h.close());

const real = loadMigrations(MIGRATIONS_DIR);
const DROP = 'stops/0003_drop_places';
/** Where the ride's one stop is (its anchor fix). */
const STOP = { lat_e7: 437_539_520, lon_e7: -794_000_000 };

test('a stop a place labelled keeps its label and the shift its split, also after a recompute', async () => {
  h = harness();
  const { cookie } = await h.signUp();
  const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
  await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  const { auth } = await h.pair(cookie);
  const t0 = h.clock.t;
  const fixes: Fix[] = ride(t0);
  const endedAt = t0 + 313 * 5000;
  const engine = (stopLabels: StopLabelInput[] = []) =>
    processShift({
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes,
      segmenter: 'stops',
      stopLabels,
      interruptions: [],
    });
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
  h.clock.t += 1000;
  const stopKey = engine().stops[0]!.stopKey;

  // The database as 0.2.0 left it after "Pizza Place" (dropoff) was saved over the stop. The server
  // then ran the engine with the place's label added to the input, exactly as with a hand label, and
  // stored the match in stops.place_id with no row in stop_labels.
  const placesSql = real.find((m) => `${m.module}/${m.id}` === 'stops/0002_places')!.sql;
  h.db.exec(placesSql);
  h.db
    .prepare("DELETE FROM schema_migrations WHERE module = 'stops' AND id = ?")
    .run(DROP.split('/')[1]);
  await web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stopKey)}`, {
    role: 'dropoff',
    edited_at: h.clock.t,
  });
  h.db
    .prepare(
      "INSERT INTO places (user_id, name, lat_e7, lon_e7, radius_m, role, created_at, updated_at) VALUES (1, 'Pizza Place', ?, ?, 100, 'dropoff', ?, ?)",
    )
    .run(STOP.lat_e7, STOP.lon_e7, h.clock.t, h.clock.t);
  h.db.prepare('DELETE FROM stop_labels').run();
  h.db.prepare('UPDATE stops SET place_id = 1').run();

  const want = engine([{ stopKey, role: 'dropoff' }]);
  expect(want.totals.activeM).not.toBe(engine().totals.activeM);
  const figures = async () => {
    const s = (await web('GET', `/shifts/${SHIFT}`)).json();
    return {
      total_m: s.total_m,
      active_m: s.active_m,
      deadhead_m: s.deadhead_m,
      personal_m: s.personal_m,
    };
  };
  const trips = async () =>
    (
      (await h.call('GET', `/shifts/${SHIFT}/trips`, undefined, auth)).json() as {
        trip_key: string;
        kind: string;
        distance_m: number;
        started_at: number;
        ended_at: number;
      }[]
    ).map((t) => ({
      trip_key: t.trip_key,
      kind: t.kind,
      distance_m: t.distance_m,
      started_at: t.started_at,
      ended_at: t.ended_at,
    }));
  const stops = async () => (await web('GET', `/shifts/${SHIFT}/stops`)).json();
  const before = { figures: await figures(), trips: await trips() };
  expect(before.figures).toEqual({
    total_m: want.totals.totalM,
    active_m: want.totals.activeM,
    deadhead_m: want.totals.deadheadM,
    personal_m: want.totals.personalM,
  });
  expect(h.db.prepare('SELECT role, est_role FROM stops').get()).toEqual({
    role: 'dropoff',
    est_role: 'pickup',
  });

  expect(migrate(h.db, real)).toEqual([DROP]);
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
  expect(tables).not.toContain('places');
  const shown = {
    role: 'dropoff',
    est_role: 'pickup',
    label: { role: 'dropoff', place: 'Pizza Place', platform: null, payout_cents: 0 },
  };
  expect((await stops())[0]).toMatchObject(shown);
  expect((await stops())[0]).not.toHaveProperty('place');
  expect(await figures()).toEqual(before.figures);
  expect(recalcReport(h.db).map((r) => r.changed)).toEqual([false]);

  // Worked out again: the same labels, split and trips, and the phone gets the same trips.
  h.clock.t += 1000;
  const again = await web('POST', `/shifts/${SHIFT}/recalculate`);
  expect(again.statusCode).toBe(200);
  expect(await figures()).toEqual(before.figures);
  expect(await trips()).toEqual(before.trips);
  expect((await stops())[0]).toMatchObject(shown);
  const flags = h.db.prepare('SELECT code FROM shift_flags').pluck().all();
  expect(flags).not.toContain('label_orphaned');
});
