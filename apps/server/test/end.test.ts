import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift, type Fix } from '@milewage/track-engine';
import { reconcile } from '../src/processing/recon';
import { ride, SHIFT, toWire } from './rides';
import { harness, TRACKING_OFF, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

async function setup(modules: Record<string, boolean> = {}, started: object = {}) {
  h = harness(modules);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call(
    'POST',
    '/shifts',
    { client_id: SHIFT, vehicle_id: 1, started_at: t0, ...started },
    auth,
  );
}
async function upload(points = fixes) {
  for (let i = 0; i < points.length; i += 100) {
    const res = await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: points.slice(i, i + 100).map(toWire) },
      auth,
    );
    expect(res.statusCode).toBe(200);
  }
}
const engine = (segmenter: 'stops' | 'whole_shift', list = fixes) =>
  processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes: list,
    segmenter,
    stopLabels: [],
    interruptions: [],
  });
const phoneResult = (
  r: ReturnType<typeof engine>,
  segmenter: 'stops' | 'whole_shift' = 'stops',
) => ({
  calc_version: r.algorithmVersion,
  segmenter,
  input_digest: r.inputDigest,
  total_m: r.totals.totalM,
  active_m: r.totals.activeM,
  deadhead_m: r.totals.deadheadM,
  personal_m: r.totals.personalM,
  trips_count: r.trips.length,
});
const manifest = (n = fixes.length) => ({ first_seq: 1, last_seq: n, point_count: n });
const end = (body: object = {}) =>
  h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt, ...body }, auth);
const row = () => h.db.prepare('SELECT * FROM shifts').get() as Record<string, unknown>;
const count = (table: string) => h.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

afterEach(() => h.close());

describe('POST /shifts/{ref}/end runs the shared engine (14 section 9.4)', () => {
  beforeEach(() => setup());

  test('the server computes and stores totals, trips, stops and flags from its own points', async () => {
    await upload();
    const res = await end();
    expect(res.statusCode).toBe(200);
    const want = engine('stops');
    expect(want.stops.length).toBeGreaterThan(0);
    expect(want.trips.length).toBeGreaterThan(1);
    expect(res.json()).toMatchObject({
      status: 'ended',
      ended_at: endedAt,
      segmenter: 'stops',
      total_m: want.totals.totalM,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
      personal_m: 0,
      calc_version: want.algorithmVersion,
      calculated_at: h.clock.t,
    });
    expect(res.json().recon).toBeUndefined();
    expect(count('trips')).toBe(want.trips.length);
    expect(count('stops')).toBe(want.stops.length);
    const trips = h.db
      .prepare('SELECT trip_key, kind, distance_m FROM trips ORDER BY started_at')
      .all();
    expect(trips).toEqual(
      want.trips.map((t) => ({ trip_key: t.tripKey, kind: t.kind, distance_m: t.distanceM })),
    );
    expect(h.db.prepare('SELECT sum(distance_m) FROM trips').pluck().get()).toBe(
      want.totals.totalM,
    );
    // total_m is the same under either segmenter (14 section 10.2 item 5).
    expect(engine('whole_shift').totals.totalM).toBe(want.totals.totalM);
    expect((await h.call('GET', `/shifts/${SHIFT}`, undefined, auth)).json().flags).toEqual(
      res.json().flags,
    );
  });

  test('a retried end answers the same and computes nothing again', async () => {
    await upload();
    const first = await end({ phone_result: phoneResult(engine('stops')), manifest: manifest() });
    const calculated = row().calculated_at;
    h.clock.t += 5000;
    const second = await end({ phone_result: phoneResult(engine('stops')), manifest: manifest() });
    expect(second.json()).toEqual(first.json());
    expect(row().calculated_at).toBe(calculated);
  });

  test('match: the phone ran the same points', async () => {
    await upload();
    const res = await end({ phone_result: phoneResult(engine('stops')), manifest: manifest() });
    const want = engine('stops');
    expect(res.json().recon).toEqual({
      status: 'match',
      server_total_m: want.totals.totalM,
      diff_m: 0,
      reasons: [],
    });
    expect(res.json()).toMatchObject({ recon_status: 'match', calc_mismatch: false });
  });

  test('points_missing: the phone saw points that never arrived', async () => {
    await upload(fixes.filter((f) => f.seq < 290));
    // The phone recorded all points; the server holds six fewer.
    const res = await end({ phone_result: phoneResult(engine('stops')), manifest: manifest() });
    const body = res.json();
    expect(body.recon.status).toBe('differs');
    expect(body.recon.reasons).toEqual(['points_missing']);
    expect(body.recon.diff_m).toBe(
      engine(
        'stops',
        fixes.filter((f) => f.seq < 290),
      ).totals.totalM - engine('stops').totals.totalM,
    );
    expect(body).toMatchObject({ recon_status: 'differs', recon_reasons: ['points_missing'] });
    expect(body.calc_mismatch).toBe(false);
  });

  test('calc_version: a phone on another engine version, digest equal or not', async () => {
    await upload();
    const phone = { ...phoneResult(engine('stops')), calc_version: 99, total_m: 1 };
    const res = await end({ phone_result: phone, manifest: manifest() });
    expect(res.json().recon.reasons).toEqual(['calc_version']);
    expect(res.json().calc_mismatch).toBe(false);
  });

  test('engine_disagreement: same input, same version, different numbers sets calc_mismatch', async () => {
    await upload();
    const phone = phoneResult(engine('stops'));
    const res = await end({
      phone_result: { ...phone, total_m: phone.total_m + 7 },
      manifest: manifest(),
    });
    const body = res.json();
    expect(body.recon).toMatchObject({
      status: 'differs',
      diff_m: -7,
      reasons: ['engine_disagreement'],
    });
    expect(body.calc_mismatch).toBe(true);
    expect(body.flags.map((f: { code: string }) => f.code)).toContain('calc_mismatch');
    expect(body.flags.find((f: { code: string }) => f.code === 'calc_mismatch').severity).toBe(
      'review',
    );
    expect(body.total_m).toBe(engine('stops').totals.totalM); // the server's number wins
  });

  test('a different digest with an unexplained difference is unknown, not a mismatch', async () => {
    await upload();
    const phone = { ...phoneResult(engine('stops')), input_digest: '0'.repeat(16), total_m: 5 };
    const res = await end({ phone_result: phone, manifest: manifest() });
    expect(res.json().recon.reasons).toEqual(['unknown']);
    expect(res.json().calc_mismatch).toBe(false);
  });

  test('no phone_result: recon_status phone_missing and no recon member', async () => {
    await upload();
    const res = await end();
    expect(res.json()).toMatchObject({ recon_status: 'phone_missing' });
    expect('recon' in res.json()).toBe(false);
  });

  test('an end with no points stores zero totals and no trips', async () => {
    const res = await end();
    expect(res.json()).toMatchObject({ total_m: 0, active_m: 0, deadhead_m: 0, status: 'ended' });
    expect(count('trips')).toBe(0);
  });

  test('interruptions are stored and flagged; bad bodies are 422', async () => {
    await upload();
    const res = await end({ interruptions: [{ from_ms: t0 + 400_000, to_ms: t0 + 500_000 }] });
    expect(res.json().flags.map((f: { code: string }) => f.code)).toContain('tracking_interrupted');
    expect(JSON.parse(String(row().interruptions_json))).toEqual([
      { from_ms: t0 + 400_000, to_ms: t0 + 500_000 },
    ]);
  });

  test('validation', async () => {
    const bad = [
      { phone_result: { ...phoneResult(engine('stops')), input_digest: 'xyz' } },
      { phone_result: { total_m: 1 } },
      { manifest: { first_seq: 5, last_seq: 2, point_count: 1 } },
      { manifest: { first_seq: 1, last_seq: 2 } },
      { interruptions: [{ from_ms: 1 }] },
    ];
    for (const b of bad) expect((await end(b)).statusCode).toBe(422);
    expect(row().status).toBe('active');
  });
});

describe('segmenter and modules', () => {
  test('a shift started with stops off keeps whole_shift when the setting is turned on later', async () => {
    await setup();
    await h.call('PATCH', '/settings', { stops_enabled: false }, { cookie });
    // the shift of setup() was started with stops on; start a second one with the setting off
    await upload();
    await end();
    await h.call(
      'POST',
      '/shifts',
      {
        client_id: '11111111-1111-4111-8111-111111111111',
        vehicle_id: 1,
        started_at: endedAt + 1000,
      },
      auth,
    );
    expect(
      h.db.prepare("SELECT segmenter FROM shifts WHERE client_id LIKE '1111%'").pluck().get(),
    ).toBe('whole_shift');
    await h.call('PATCH', '/settings', { stops_enabled: true }, { cookie });
    expect(
      h.db.prepare("SELECT segmenter FROM shifts WHERE client_id LIKE '1111%'").pluck().get(),
    ).toBe('whole_shift');
  });

  test('segmenter whole_shift: one trip, no stops, same total', async () => {
    await setup({}, { segmenter: 'whole_shift' });
    await upload();
    const res = await end();
    expect(res.json().total_m).toBe(engine('stops').totals.totalM);
    expect(res.json()).toMatchObject({ segmenter: 'whole_shift', deadhead_m: 0 });
    expect(count('trips')).toBe(1);
    expect(count('stops')).toBe(0);
  });

  test('stops module off: the engine still follows the shift but no stops are stored', async () => {
    await setup({ stops: false });
    await upload();
    const res = await end();
    expect(res.json().total_m).toBe(engine('stops').totals.totalM);
    expect(count('stops')).toBe(0);
  });

  test('tracking off: the shift ends with null totals and nothing is derived', async () => {
    await setup(TRACKING_OFF);
    const res = await end({ phone_result: phoneResult(engine('stops')) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ended', total_m: null, calc_version: null });
    expect(count('trips')).toBe(0);
  });
});

describe('reconcile (15 section 7.3)', () => {
  const server = {
    inputDigest: 'a'.repeat(16),
    algorithmVersion: 3,
    totals: { totalM: 100, activeM: 60, deadheadM: 40, personalM: 0 },
  };
  const phone = {
    calcVersion: 3,
    inputDigest: 'a'.repeat(16),
    totalM: 100,
    activeM: 60,
    deadheadM: 40,
    personalM: 0,
  };
  test.each([
    ['equal', {}, 'match', []],
    [
      'split differs, same digest and version',
      { activeM: 61, deadheadM: 39 },
      'differs',
      ['engine_disagreement'],
    ],
    [
      'version differs with the same digest',
      { activeM: 61, deadheadM: 39, calcVersion: 2 },
      'differs',
      ['calc_version'],
    ],
    ['digest differs, same total', { inputDigest: 'b'.repeat(16) }, 'match', []],
    [
      'digest differs, other total',
      { inputDigest: 'b'.repeat(16), totalM: 90 },
      'differs',
      ['unknown'],
    ],
  ])('%s', (_n, change, status, reasons) => {
    const r = reconcile({ server, phone: { ...phone, ...change }, storedPoints: 10 });
    expect([r.status, r.reasons]).toEqual([status, reasons]);
  });
  test('reasons come in the order of the spec and can combine', () => {
    const r = reconcile({
      server,
      phone: { ...phone, inputDigest: 'b'.repeat(16), totalM: 90, calcVersion: 2 },
      manifest: { pointCount: 12 },
      storedPoints: 10,
      editedOnWeb: true,
      latePoints: true,
    });
    expect(r.reasons).toEqual(['points_missing', 'calc_version', 'edited_on_web', 'late_points']);
    expect(r.diffM).toBe(10);
  });
});
