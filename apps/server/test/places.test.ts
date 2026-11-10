import { afterEach, describe, expect, test } from 'vitest';
import { processShift, type Fix, type StopLabelInput } from '@milewage/track-engine';
import type { PlaceRow } from '../src/db';
import { detectedStopsOf, placeAt, withPlaces } from '../src/processing/places';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

// ADR 0008: named places label the stops inside them, before the engine runs, on the server only.
let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

/** Where the ride's one stop is (its anchor fix). */
const STOP = { lat_e7: 437_539_520, lon_e7: -794_000_000 };
/** About 50 m north of the stop (4496 e7 of latitude). */
const NORTH_50M = { lat_e7: STOP.lat_e7 + 4496, lon_e7: STOP.lon_e7 };

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
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const shift = async () => (await web('GET', `/shifts/${SHIFT}`)).json();
const stops = async () => (await web('GET', `/shifts/${SHIFT}/stops`)).json();
const place = (extra: object = {}) => ({ name: 'Pizza Place', ...STOP, role: 'dropoff', ...extra });

async function setup(o: { end?: 'now' | 'later'; phoneResult?: boolean } = {}) {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
  }
  if (o.end !== 'later') await endShift(o.phoneResult);
}
/** The phone's own result has no labels and no places: it never sees them (decision 1.5b). */
async function endShift(phoneResult = false) {
  const r = engine();
  const body = phoneResult
    ? {
        phone_result: {
          calc_version: r.algorithmVersion,
          segmenter: 'stops',
          input_digest: r.inputDigest,
          total_m: r.totals.totalM,
          active_m: r.totals.activeM,
          deadhead_m: r.totals.deadheadM,
          personal_m: r.totals.personalM,
          trips_count: r.trips.length,
        },
        manifest: { first_seq: 1, last_seq: fixes.length, point_count: fixes.length },
      }
    : {};
  return h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt, ...body }, auth);
}
describe('matching (ADR 0008)', () => {
  const row = (id: number, lat: number, radiusM: number): PlaceRow => ({
    id,
    userId: 1,
    name: `p${id}`,
    latE7: lat,
    lonE7: 0,
    radiusM,
    role: 'pickup',
    createdAt: 0,
    updatedAt: 0,
  });
  test('inside the radius, nearest centre wins, an exact tie goes to the oldest', () => {
    const at = { latE7: 0, lonE7: 0 };
    // 1000 e7 of latitude is 11.1 m, so 9000 is 100.1 m.
    expect(placeAt(at, [row(1, 9000, 101)])?.id).toBe(1);
    expect(placeAt(at, [row(1, 9000, 100)])).toBeUndefined();
    expect(placeAt(at, [row(1, 9000, 200), row(2, 1000, 200)])?.id).toBe(2);
    expect(placeAt(at, [row(3, 2000, 200), row(2, -2000, 200)])?.id).toBe(2);
    expect(placeAt(at, [row(2, -2000, 200), row(3, 2000, 200)])?.id).toBe(2);
  });
});

describe('matching on a ride', () => {
  afterEach(() => h.close());
  test('the stops matched before the run are the stops the run finds', async () => {
    await setup({ end: 'later' });
    const input = {
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes,
      segmenter: 'stops' as const,
      stopLabels: [],
      interruptions: [],
    };
    expect(detectedStopsOf(input).map((s) => s.stopKey)).toEqual(
      processShift(input).stops.map((s) => s.stopKey),
    );
    const p: PlaceRow = {
      id: 1,
      userId: 1,
      name: 'p1',
      latE7: STOP.lat_e7,
      lonE7: STOP.lon_e7,
      radiusM: 100,
      role: 'dropoff',
      createdAt: 0,
      updatedAt: 0,
    };
    const placed = withPlaces(input, [p]);
    expect(placed.placeLabels).toBe(1);
    expect(placed.input.stopLabels).toEqual([
      { stopKey: engine().stops[0]!.stopKey, role: 'dropoff' },
    ]);
    // A whole-shift input has no stops to match.
    expect(withPlaces({ ...input, segmenter: 'whole_shift' }, [p]).placeOf.size).toBe(0);
  });
});

describe('places on the web', () => {
  afterEach(() => h.close());
  test('saving a place over a stop labels it and works the shift out again; the total never moves', async () => {
    await setup();
    const before = await shift();
    const stopKey = engine().stops[0]!.stopKey;
    const res = await web('POST', '/places', place());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      place: { name: 'Pizza Place', ...STOP, radius_m: 100, role: 'dropoff' },
      shifts_recalculated: 1,
      shifts_kept: 0,
    });
    const want = engine([{ stopKey, role: 'dropoff' }]);
    expect(want.totals.activeM).not.toBe(before.active_m);
    expect(await shift()).toMatchObject({
      total_m: before.total_m,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
    });
    expect((await stops())[0]).toMatchObject({
      est_role: 'pickup',
      role: 'dropoff',
      label: null,
      place: { id: body.place.id, name: 'Pizza Place', role: 'dropoff' },
    });
    expect((await web('GET', '/places')).json()).toEqual([body.place]);
    // Renamed: the name follows; nothing else changes.
    await web('PATCH', `/places/${body.place.id}`, { name: 'Pizza Palace' });
    expect((await stops())[0].place.name).toBe('Pizza Palace');
  });

  test('a hand label always wins; the place name is still shown', async () => {
    await setup();
    const stopKey = engine().stops[0]!.stopKey;
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stopKey)}`, {
      role: 'other',
      edited_at: h.clock.t,
    });
    const labelled = await shift();
    await web('POST', '/places', place({ role: 'dropoff' }));
    expect(await shift()).toMatchObject({
      active_m: labelled.active_m,
      deadhead_m: labelled.deadhead_m,
    });
    expect((await stops())[0]).toMatchObject({
      role: 'other',
      label: { role: 'other' },
      place: { name: 'Pizza Place' },
    });
  });

  test('overlapping places: the nearest centre wins', async () => {
    await setup();
    await web('POST', '/places', place({ name: 'Far', ...NORTH_50M, radius_m: 200 }));
    await web('POST', '/places', place({ name: 'Near', role: 'pickup', radius_m: 25 }));
    expect((await stops())[0].place.name).toBe('Near');
    expect((await stops())[0].role).toBe('pickup');
  });

  test('moving a place away and deleting one work the shift out again', async () => {
    await setup();
    const original = await shift();
    const id = (await web('POST', '/places', place())).json().place.id;
    const moved = await web('PATCH', `/places/${id}`, {
      lat_e7: STOP.lat_e7 + 90_000, // about 1 km north
    });
    expect(moved.json()).toMatchObject({ shifts_recalculated: 1 });
    expect((await stops())[0]).toMatchObject({ role: 'pickup', place: null });
    expect(await shift()).toMatchObject({ active_m: original.active_m });

    const back = (await web('POST', '/places', place())).json().place.id;
    expect((await stops())[0].role).toBe('dropoff');
    const gone = await web('DELETE', `/places/${back}`);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toEqual({ place: null, shifts_recalculated: 1, shifts_kept: 0 });
    expect((await stops())[0]).toMatchObject({ role: 'pickup', place: null });
    expect(await shift()).toMatchObject({ active_m: original.active_m });
  });

  test('a finalized shift keeps its figures and is counted as kept', async () => {
    await setup();
    await web('POST', `/shifts/${SHIFT}/finalize`);
    const before = await shift();
    const res = await web('POST', '/places', place());
    expect(res.json()).toMatchObject({ shifts_recalculated: 0, shifts_kept: 1 });
    expect(await shift()).toMatchObject({
      active_m: before.active_m,
      calculated_at: before.calculated_at,
    });
    expect((await stops())[0].place).toBeNull();
  });

  test('a place saved before the shift ends labels it at the end; the phone result still matches', async () => {
    await setup({ end: 'later' });
    await web('POST', '/places', place());
    const res = await endShift(true);
    const stopKey = engine().stops[0]!.stopKey;
    const want = engine([{ stopKey, role: 'dropoff' }]);
    // Labels never change the total: the phone's unlabelled result is a match, not a difference.
    expect(res.json()).toMatchObject({
      recon_status: 'match',
      calc_mismatch: false,
      active_m: want.totals.activeM,
    });
    expect(res.json().recon).toMatchObject({ status: 'match', reasons: [] });
    expect((await stops())[0].role).toBe('dropoff');
    // The new trips reach the phone through the change feed like any other web edit.
    const feed = (await h.call('GET', '/sync/changes', undefined, auth)).json();
    expect(feed.changes.filter((c: { entity: string }) => c.entity === 'trip')).toHaveLength(
      want.trips.length,
    );
  });

  test('refusals: a device, stop detection off, a bad radius, an unknown place', async () => {
    await setup();
    expect((await h.call('GET', '/places', undefined, auth)).statusCode).toBe(403);
    expect((await web('POST', '/places', place({ radius_m: 10 }))).statusCode).toBe(422);
    expect((await web('POST', '/places', place({ radius_m: 1001 }))).statusCode).toBe(422);
    expect((await web('POST', '/places', place({ name: '   ' }))).statusCode).toBe(422);
    expect((await web('PATCH', '/places/99', { name: 'x' })).statusCode).toBe(404);
    expect((await web('DELETE', '/places/99')).statusCode).toBe(404);
    await web('PATCH', '/settings', { stops_enabled: false });
    expect((await web('GET', '/places')).statusCode).toBe(404);
    expect((await web('POST', '/places', place())).statusCode).toBe(404);
  });

  test('places stay out of diagnostics', async () => {
    await setup();
    await web('POST', '/places', place({ name: 'Secret Diner' }));
    const all = h.db.prepare('SELECT * FROM places').all();
    expect(all).toHaveLength(1);
    const events = (await web('GET', '/diagnostics/events?src=server')).json().items ?? [];
    const text = JSON.stringify(events);
    expect(text).not.toContain('Secret Diner');
    expect(text).not.toContain(String(STOP.lat_e7));
  });
});
