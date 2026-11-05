import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift, type Fix, type TripEdit } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, TRACKING_OFF, type Harness } from './support';

type Trip = {
  id: number;
  trip_key: string;
  kind: string;
  original_kind: string;
  source: string;
  distance_m: number;
};
let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const key = (k: string) => encodeURIComponent(k);
const MANUAL = 'aaaaaaaa-1111-4222-8333-444444444444';
const engine = (edits: TripEdit[] = []) =>
  processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes,
    segmenter: 'stops',
    stopLabels: [],
    interruptions: [],
    edits,
  });
const trips = async (): Promise<Trip[]> => (await web('GET', `/shifts/${SHIFT}/trips`)).json();
const manualBody = (extra: object = {}) => ({
  kind: 'active',
  started_at: t0 + 1000,
  ended_at: t0 + 60_000,
  distance_m: 1500,
  purpose: 'Pickup the tracker missed',
  edited_at: h.clock.t,
  ...extra,
});
const flagCodes = (shift: { flags: { code: string }[] }) => shift.flags.map((f) => f.code);

async function setup(modules: Record<string, boolean> = {}, track = true) {
  h = harness(modules);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  if (track) {
    for (let i = 0; i < fixes.length; i += 100) {
      const points = fixes.slice(i, i + 100).map(toWire);
      await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
    }
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
}
afterEach(() => h.close());

describe('trip overrides (07 section 2.7, 14 section 6.7)', () => {
  beforeEach(() => setup());

  test('PATCH /trips/{id} reclassifies an auto trip through an override; the total never moves', async () => {
    const before = (await web('GET', `/shifts/${SHIFT}`)).json();
    const [first] = await trips();
    expect(first!.source).toBe('auto');
    const res = await web('PATCH', `/trips/${first!.id}`, { kind: 'personal', purpose: 'Errand' });
    expect(res.statusCode).toBe(200);
    const want = engine([{ tripKey: first!.trip_key, kind: 'personal', purpose: 'Errand' }]);
    expect(res.json().trip).toMatchObject({ kind: 'personal', purpose: 'Errand' });
    expect(res.json().trip.edited_at).toBeGreaterThan(0);
    expect(res.json().trip.original_kind).toBe(first!.original_kind);
    expect(res.json().shift).toMatchObject({
      total_m: before.total_m,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
      personal_m: want.totals.personalM,
    });
    expect(h.db.prepare('SELECT count(*) FROM trip_overrides').pluck().get()).toBe(1);
  });

  test('the override survives a recompute that runs the engine again', async () => {
    const [first] = await trips();
    await web('PATCH', `/trips/${first!.id}`, { kind: 'personal' });
    const stopKey = engine().stops[0]!.stopKey;
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`, {
      role: 'pickup',
      edited_at: h.clock.t,
    });
    const after = (await trips()).find((x) => x.trip_key === first!.trip_key);
    expect(after?.kind).toBe('personal');
  });

  test('PUT trip-overrides is idempotent and last writer wins; ties go to the server', async () => {
    const [first] = await trips();
    const url = `/shifts/${SHIFT}/trip-overrides/${key(first!.trip_key)}`;
    const put = (extra: object, who: object = auth) =>
      h.call(
        'PUT',
        url,
        { kind: 'personal', purpose: 'Phone', edited_at: h.clock.t, ...extra },
        who,
      );
    const a = await put({});
    expect(a.statusCode).toBe(200);
    expect(a.headers['x-milewage-applied']).toBe('true');
    expect(a.json().trip.kind).toBe('personal');
    const tie = await put({ kind: 'deadhead' });
    expect(tie.headers['x-milewage-applied']).toBe('false');
    expect(tie.json().trip.kind).toBe('personal');
    const older = await put({ kind: 'deadhead', edited_at: h.clock.t - 1 });
    expect(older.headers['x-milewage-applied']).toBe('false');
    const newer = await put(
      { kind: 'deadhead', purpose: 'Web', edited_at: h.clock.t + 1 },
      { cookie },
    );
    expect(newer.headers['x-milewage-applied']).toBe('true');
    expect(newer.json().trip).toMatchObject({ kind: 'deadhead', purpose: 'Web' });
    const log = h.db.prepare('SELECT entity, key, superseded_json FROM overwrite_log').all() as {
      entity: string;
      superseded_json: string;
    }[];
    expect(log.filter((l) => l.entity === 'trip_override')).toHaveLength(1);
    expect(JSON.parse(log[0]!.superseded_json)).toMatchObject({
      kind: 'personal',
      purpose: 'Phone',
    });
  });

  test('an override with no matching trip is kept, flagged and sent to the phone as orphaned_override', async () => {
    const ghost = `${SHIFT}:1:active`;
    const res = await h.call(
      'PUT',
      `/shifts/${SHIFT}/trip-overrides/${key(ghost)}`,
      { kind: 'personal', purpose: 'x', edited_at: h.clock.t },
      auth,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().trip).toBeNull();
    expect(flagCodes(res.json().shift)).toContain('override_orphaned');
    expect(h.db.prepare('SELECT count(*) FROM trip_overrides').pluck().get()).toBe(1);
    const pulled = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const entry = pulled.changes.find((c: { entity: string }) => c.entity === 'override');
    expect(entry).toMatchObject({ op: 'orphaned_override', key: ghost });
    expect(entry.data).toMatchObject({ kind: 'personal', purpose: 'x', trip_key: ghost });
  });

  test('a live override reaches the phone as an upsert beside its trip', async () => {
    const [first] = await trips();
    await web('PATCH', `/trips/${first!.id}`, { purpose: 'Business' });
    const pulled = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const entry = pulled.changes.find((c: { entity: string }) => c.entity === 'override');
    expect(entry).toMatchObject({ op: 'upsert', key: first!.trip_key });
    const trip = pulled.changes.find(
      (c: { entity: string; key: string }) => c.entity === 'trip' && c.key === first!.trip_key,
    );
    expect(trip.data.purpose).toBe('Business');
  });

  test('refusals: finalized, unknown shift or trip, invalid body, device cannot DELETE', async () => {
    const [first] = await trips();
    const url = `/shifts/${SHIFT}/trip-overrides/${key(first!.trip_key)}`;
    const body = { kind: 'personal', purpose: 'x', edited_at: h.clock.t };
    expect((await web('PATCH', '/trips/9999', { kind: 'personal' })).statusCode).toBe(404);
    expect((await web('PATCH', `/trips/${first!.id}`, {})).statusCode).toBe(422);
    expect((await web('PATCH', `/trips/${first!.id}`, { distance_m: 1 })).statusCode).toBe(422);
    expect((await web('PUT', url, { ...body, kind: 'x' })).statusCode).toBe(422);
    expect((await web('PUT', url, { ...body, edited_at: h.clock.t + 3_600_000 })).statusCode).toBe(
      422,
    );
    expect((await h.call('DELETE', `/trips/${first!.id}`, undefined, auth)).statusCode).toBe(403);
    h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
    expect((await web('PUT', url, body)).json().code).toBe('shift_finalized');
    expect((await web('PATCH', `/trips/${first!.id}`, { kind: 'personal' })).json().code).toBe(
      'shift_finalized',
    );
    expect((await web('PUT', `/shifts/nope/trip-overrides/x`, body)).statusCode).toBe(422);
  });

  test('with tracking off the override route is gone and an auto trip cannot be edited', async () => {
    await h.close();
    await setup(TRACKING_OFF);
    // no auto trips exist without tracking; the route does not exist either
    const res = await web('PUT', `/shifts/${SHIFT}/trip-overrides/x`, {
      kind: 'personal',
      purpose: 'x',
      edited_at: h.clock.t,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('manual trips (07 section 3 rule 8)', () => {
  beforeEach(() => setup());

  test('PUT adds a trip that counts in the totals and flags manual_trip_present; a retry changes nothing', async () => {
    const before = (await web('GET', `/shifts/${SHIFT}`)).json();
    const url = `/shifts/${SHIFT}/trips/${MANUAL}`;
    const res = await h.call('PUT', url, manualBody(), auth);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-milewage-applied']).toBe('true');
    expect(res.json().trip).toMatchObject({ source: 'manual', distance_m: 1500, kind: 'active' });
    expect(res.json().shift).toMatchObject({
      total_m: before.total_m + 1500,
      active_m: before.active_m + 1500,
      deadhead_m: before.deadhead_m,
    });
    expect(flagCodes(res.json().shift)).toContain('manual_trip_present');
    const again = await h.call('PUT', url, manualBody(), auth);
    expect(again.headers['x-milewage-applied']).toBe('false');
    expect(again.json().shift.total_m).toBe(before.total_m + 1500);
    expect(h.db.prepare("SELECT count(*) FROM trips WHERE source = 'manual'").pluck().get()).toBe(
      1,
    );
  });

  test('the manual trip survives a recompute of the engine', async () => {
    await h.call('PUT', `/shifts/${SHIFT}/trips/${MANUAL}`, manualBody(), auth);
    const stopKey = engine().stops[0]!.stopKey;
    const res = await web('PUT', `/shifts/${SHIFT}/stop-labels/${key(stopKey)}`, {
      role: 'dropoff',
      edited_at: h.clock.t,
    });
    expect(res.json().shift.total_m).toBe(engine().totals.totalM + 1500);
    expect((await trips()).filter((x) => x.source === 'manual')).toHaveLength(1);
  });

  test('a newer edit replaces the trip and keeps the old values in the overwrite log', async () => {
    const url = `/shifts/${SHIFT}/trips/${MANUAL}`;
    await h.call('PUT', url, manualBody(), auth);
    const res = await web('PUT', url, manualBody({ distance_m: 900, edited_at: h.clock.t + 5 }));
    expect(res.headers['x-milewage-applied']).toBe('true');
    expect(res.json().trip.distance_m).toBe(900);
    const old = h.db
      .prepare("SELECT superseded_json FROM overwrite_log WHERE entity = 'trip'")
      .pluck()
      .get();
    expect(JSON.parse(old as string)).toMatchObject({ distance_m: 1500 });
  });

  test('PATCH changes kind and purpose of a manual trip directly, DELETE removes it', async () => {
    const put = await h.call('PUT', `/shifts/${SHIFT}/trips/${MANUAL}`, manualBody(), auth);
    const id = put.json().trip.id as number;
    const base = engine().totals;
    const patched = await web('PATCH', `/trips/${id}`, { kind: 'personal' });
    expect(patched.json().trip.kind).toBe('personal');
    expect(patched.json().shift.personal_m).toBe(base.personalM + 1500);
    expect(h.db.prepare('SELECT count(*) FROM trip_overrides').pluck().get()).toBe(0);
    const del = await web('DELETE', `/trips/${id}`);
    expect(del.statusCode).toBe(204);
    const shift = (await web('GET', `/shifts/${SHIFT}`)).json();
    expect(shift.total_m).toBe(base.totalM);
    expect(flagCodes(shift)).not.toContain('manual_trip_present');
  });

  test('DELETE of an auto trip is 409 trip_not_editable; unknown is 404', async () => {
    const [first] = await trips();
    const res = await web('DELETE', `/trips/${first!.id}`);
    expect([res.statusCode, res.json().code]).toEqual([409, 'trip_not_editable']);
    expect((await web('DELETE', '/trips/9999')).statusCode).toBe(404);
  });

  test('the phone sees the manual trip, and its deletion, through the change feed', async () => {
    const put = await h.call('PUT', `/shifts/${SHIFT}/trips/${MANUAL}`, manualBody(), auth);
    const first = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const entry = first.changes.find((c: { key: string }) => c.key === MANUAL);
    expect(entry).toMatchObject({ entity: 'trip', op: 'upsert' });
    expect(entry.data.source).toBe('manual');
    await web('DELETE', `/trips/${put.json().trip.id}`);
    const next = (
      await h.call('GET', `/sync/changes?after=${first.next_cursor}`, undefined, auth)
    ).json();
    expect(next.changes.find((c: { key: string }) => c.key === MANUAL)).toMatchObject({
      entity: 'trip',
      op: 'delete',
      data: null,
    });
  });

  test('refusals: finalized, bad times, a client id that belongs to an auto trip or another shift', async () => {
    const url = `/shifts/${SHIFT}/trips/${MANUAL}`;
    expect((await web('PUT', url, manualBody({ ended_at: t0 }))).statusCode).toBe(422);
    expect((await web('PUT', url, manualBody({ distance_m: 0 }))).statusCode).toBe(422);
    expect((await web('PUT', url, manualBody({ extra: 1 }))).statusCode).toBe(422);
    expect((await web('PUT', `/shifts/${SHIFT}/trips/not-a-uuid`, manualBody())).statusCode).toBe(
      422,
    );
    expect(
      (await web('PUT', url, manualBody({ edited_at: h.clock.t + 3_600_000 }))).statusCode,
    ).toBe(422);
    const [auto] = await trips();
    const clash = await web('PUT', `/shifts/${SHIFT}/trips/${auto!.trip_key}`, manualBody());
    expect(clash.statusCode).toBe(422);
    h.db.prepare("UPDATE shifts SET status = 'finalized'").run();
    expect((await web('PUT', url, manualBody())).json().code).toBe('shift_finalized');
  });
});

describe('manual trips with tracking off', () => {
  test('the logbook runs on manual trips: totals come from the stored trips alone', async () => {
    await setup(TRACKING_OFF, false);
    const res = await web('PUT', `/shifts/${SHIFT}/trips/${MANUAL}`, manualBody());
    expect(res.statusCode).toBe(200);
    expect(res.json().shift).toMatchObject({ total_m: 1500, active_m: 1500, personal_m: 0 });
    expect(flagCodes(res.json().shift)).toContain('manual_trip_present');
    const patched = await web('PATCH', `/trips/${res.json().trip.id}`, { kind: 'deadhead' });
    expect(patched.json().shift).toMatchObject({ total_m: 1500, active_m: 0, deadhead_m: 1500 });
  });
});
