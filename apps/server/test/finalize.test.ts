import { afterEach, describe, expect, test } from 'vitest';
import { processShift, type Fix } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, TRACKING_OFF, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let fixes: Fix[];
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const engine = (of: Fix[] = fixes) =>
  processShift({
    shiftClientId: SHIFT,
    startedAt: t0,
    endedAt,
    fixes: of,
    segmenter: 'stops',
    stopLabels: [],
    interruptions: [],
  });
const upload = (of: Fix[]) =>
  h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points: of.map(toWire) }, auth);

async function setup({
  points = 312,
  modules = {},
  phone,
  ...extra
}: {
  points?: number;
  modules?: Record<string, boolean>;
  phone?: (r: ReturnType<typeof engine>) => object;
  lateRecomputeMs?: number;
} = {}) {
  h = harness(modules, extra);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  await upload(fixes.slice(0, points));
  const res = await h.call(
    'POST',
    `/shifts/${SHIFT}/end`,
    { ended_at: endedAt, ...(phone ? phone(engine()) : {}) },
    auth,
  );
  return res.json();
}
const phoneFull = (r: ReturnType<typeof engine>, n = 312) => ({
  manifest: { first_seq: 1, last_seq: n, point_count: n },
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
});
const shift = async () => (await web('GET', `/shifts/${SHIFT}`)).json();
const runs = () => h.db.prepare('SELECT count(*) FROM test_runs').pluck().get();
afterEach(() => h.close());

describe('POST /shifts/{ref}/finalize (14 section 11)', () => {
  test('finalizes an ended shift once; an active shift is refused; devices cannot', async () => {
    await setup();
    expect((await h.call('POST', `/shifts/${SHIFT}/finalize`, undefined, auth)).statusCode).toBe(
      403,
    );
    const res = await web('POST', `/shifts/${SHIFT}/finalize`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('finalized');
    const again = await web('POST', `/shifts/${SHIFT}/finalize`);
    expect([again.statusCode, again.json().status]).toEqual([200, 'finalized']);
    expect((await web('POST', `/shifts/nope/finalize`)).statusCode).toBe(422);
    const other = '33333333-4444-4555-8666-777777777777';
    await h.call(
      'POST',
      '/shifts',
      { client_id: other, vehicle_id: 1, started_at: h.clock.t },
      auth,
    );
    expect((await web('POST', `/shifts/${other}/finalize`)).json().code).toBe('shift_not_ended');
  });

  test('a finalized shift refuses every change: recalculate, points, labels, trips, notes', async () => {
    await setup();
    const [trip] = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    const stopKey = engine().stops[0]!.stopKey;
    await web('POST', `/shifts/${SHIFT}/finalize`);
    const before = await shift();
    const code = async (r: ReturnType<typeof web>) => (await r).json().code;
    expect(await code(web('POST', `/shifts/${SHIFT}/recalculate`))).toBe('shift_finalized');
    expect((await upload(fixes.slice(0, 5))).json().code).toBe('shift_finalized');
    expect(
      await code(
        web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stopKey)}`, {
          role: 'dropoff',
          edited_at: h.clock.t,
        }),
      ),
    ).toBe('shift_finalized');
    expect(await code(web('PATCH', `/trips/${trip.id}`, { kind: 'personal' }))).toBe(
      'shift_finalized',
    );
    expect(await code(web('PATCH', `/shifts/${SHIFT}`, { notes: 'x' }))).toBe('shift_finalized');
    expect(await shift()).toEqual(before);
  });

  test('late points that were already accepted do not recompute a shift finalized meanwhile', async () => {
    await setup({ points: 200, lateRecomputeMs: 40 });
    const total = (await shift()).total_m;
    await upload(fixes.slice(200)); // accepted: starts the debounce
    await web('POST', `/shifts/${SHIFT}/finalize`);
    await new Promise((r) => setTimeout(r, 150));
    expect((await shift()).total_m).toBe(total);
    expect(total).not.toBe(engine().totals.totalM);
  });
});

describe('POST /shifts/{ref}/recalculate (14 section 11)', () => {
  test('recomputes with the current algorithm and restores a stale result; active is refused', async () => {
    await setup();
    const want = engine();
    h.db
      .prepare('UPDATE shifts SET calc_version = 1, total_m = 1, active_m = 1, deadhead_m = 0')
      .run();
    h.db.prepare('DELETE FROM trips').run();
    const res = await web('POST', `/shifts/${SHIFT}/recalculate`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      calc_version: want.algorithmVersion,
      total_m: want.totals.totalM,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
    });
    expect(h.db.prepare('SELECT count(*) FROM trips').pluck().get()).toBe(want.trips.length);
    const again = await web('POST', `/shifts/${SHIFT}/recalculate`);
    expect(again.json().total_m).toBe(want.totals.totalM);
    expect((await h.call('POST', `/shifts/${SHIFT}/recalculate`, undefined, auth)).statusCode).toBe(
      403,
    );
    const other = '33333333-4444-4555-8666-777777777777';
    await h.call(
      'POST',
      '/shifts',
      { client_id: other, vehicle_id: 1, started_at: h.clock.t },
      auth,
    );
    expect((await web('POST', `/shifts/${other}/recalculate`)).json().code).toBe('shift_not_ended');
  });

  test('keeps overrides and manual trips; with tracking off it re-adds the stored trips', async () => {
    await setup();
    const [trip] = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    await web('PATCH', `/trips/${trip.id}`, { kind: 'personal' });
    await h.call(
      'PUT',
      `/shifts/${SHIFT}/trips/aaaaaaaa-1111-4222-8333-444444444444`,
      {
        kind: 'active',
        started_at: t0 + 1000,
        ended_at: t0 + 2000,
        distance_m: 700,
        purpose: 'x',
        edited_at: h.clock.t,
      },
      auth,
    );
    const before = await shift();
    const res = (await web('POST', `/shifts/${SHIFT}/recalculate`)).json();
    expect(res.total_m).toBe(before.total_m);
    expect(res.personal_m).toBe(before.personal_m);
    expect(res.flags).toEqual(before.flags);
  });

  test('with tracking off a recalculate adds up the stored trips and runs no engine', async () => {
    await setup({ modules: TRACKING_OFF, points: 0 });
    const id = 'aaaaaaaa-1111-4222-8333-444444444444';
    await web('PUT', `/shifts/${SHIFT}/trips/${id}`, {
      kind: 'deadhead',
      started_at: t0 + 1000,
      ended_at: t0 + 2000,
      distance_m: 700,
      purpose: 'x',
      edited_at: h.clock.t,
    });
    h.db.prepare('UPDATE shifts SET total_m = 0, deadhead_m = 0').run();
    const res = await web('POST', `/shifts/${SHIFT}/recalculate`);
    expect(res.json()).toMatchObject({ total_m: 700, deadhead_m: 700, calc_version: null });
  });
});

describe('late points recompute an ended shift, debounced 5 s (08 section 5 step 6)', () => {
  test('the shift is recomputed once after a burst of late batches, and recon explains it', async () => {
    let partial!: ReturnType<typeof engine>;
    await setup({
      points: 200,
      lateRecomputeMs: 60,
      phone: () => phoneFull((partial = engine(fixes.slice(0, 200))), 200),
    });
    h.db.exec(`CREATE TABLE test_runs (n INTEGER);
      CREATE TRIGGER count_runs AFTER UPDATE OF calc_version ON shifts BEGIN INSERT INTO test_runs VALUES (1); END;`);
    const first = await shift();
    expect(first.total_m).toBe(partial.totals.totalM);
    for (const part of [fixes.slice(200, 240), fixes.slice(240, 280), fixes.slice(280)]) {
      await upload(part);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(runs()).toBe(0); // still waiting: each batch restarts the debounce
    await new Promise((r) => setTimeout(r, 200));
    expect(runs()).toBe(1);
    const done = await shift();
    expect(done.total_m).toBe(engine().totals.totalM);
    expect(done.total_m).toBeGreaterThan(first.total_m);
    expect(h.db.prepare('SELECT recon_status, recon_reasons FROM shifts').get()).toEqual({
      recon_status: 'differs',
      recon_reasons: JSON.stringify(['late_points']),
    });
  });

  test('a phone that had every point ends as match, and a recompute keeps it so', async () => {
    const res = await setup({ phone: phoneFull, lateRecomputeMs: 20 });
    expect(res.recon).toMatchObject({ status: 'match' });
    await web('POST', `/shifts/${SHIFT}/recalculate`);
    expect(h.db.prepare('SELECT recon_status FROM shifts').pluck().get()).toBe('match');
  });

  test('a recompute with equal inputs and a different phone total is an engine disagreement', async () => {
    await setup({
      phone: (r) => {
        const p = phoneFull(r) as { phone_result: { total_m: number } };
        p.phone_result.total_m += 40;
        return p;
      },
    });
    expect(h.db.prepare('SELECT recon_status, calc_mismatch FROM shifts').get()).toEqual({
      recon_status: 'differs',
      calc_mismatch: 1,
    });
    await web('POST', `/shifts/${SHIFT}/recalculate`);
    const s = await shift();
    expect(s.calc_mismatch).toBe(true);
    expect(s.recon_reasons).toEqual(['engine_disagreement']);
    expect(s.flags.map((f: { code: string }) => f.code)).toContain('calc_mismatch');
  });

  test('points for an active shift are not computed until it ends', async () => {
    h = harness({}, { lateRecomputeMs: 20 });
    ({ cookie } = await h.signUp());
    await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
    ({ auth } = await h.pair(cookie));
    t0 = h.clock.t;
    fixes = ride(t0);
    h.clock.t = t0 + 313 * 5000 + 60_000;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await upload(fixes);
    await new Promise((r) => setTimeout(r, 100));
    expect((await shift()).total_m).toBeNull();
  });
});
