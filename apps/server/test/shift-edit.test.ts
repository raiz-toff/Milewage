import { afterEach, describe, expect, test } from 'vitest';
import { ride, SHIFT, toWire } from './rides';
import { harness, TRACKING_OFF, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const count = (sql: string) => h.db.prepare(sql).pluck().get() as number;

async function setup({
  end = true,
  modules = {},
}: { end?: boolean; modules?: Record<string, boolean> } = {}) {
  h = harness(modules);
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  await h.call(
    'POST',
    '/telemetry/batch',
    { shift_client_id: SHIFT, points: ride(t0).map(toWire) },
    auth,
  );
  if (end) await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
}
afterEach(async () => {
  await h?.close();
  h = undefined as never;
});

describe('PATCH /shifts/{ref} start and end time (spec 001 A4)', () => {
  test('a shorter end recomputes from the points inside the window; the original end brings them back', async () => {
    await setup();
    const full = (await web('GET', `/shifts/${SHIFT}`)).json();
    expect(full.total_m).toBeGreaterThan(0);

    const cut = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: t0 + 100 * 5000 });
    expect(cut.statusCode).toBe(200);
    const shorter = cut.json();
    expect(shorter.ended_at).toBe(t0 + 100 * 5000);
    expect(shorter.total_m).toBeLessThan(full.total_m);
    expect(shorter.calculated_at).toBeGreaterThanOrEqual(full.calculated_at);
    // The stored trips are the engine's new ones.
    const trips = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    expect(trips.reduce((n: number, t: { distance_m: number }) => n + t.distance_m, 0)).toBe(
      shorter.total_m,
    );

    const back = (await web('PATCH', `/shifts/${SHIFT}`, { ended_at: endedAt })).json();
    expect(back.total_m).toBe(full.total_m);
  });

  test('a new start sets the local date; the phone is told through the change feed', async () => {
    await setup();
    const first = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const day = 24 * 3_600_000;
    // Start a day earlier: the points before the old start are gone, so only the date and window move.
    const res = await web('PATCH', `/shifts/${SHIFT}`, { started_at: t0 - day });
    expect(res.statusCode).toBe(200);
    expect(res.json().started_at).toBe(t0 - day);
    expect(res.json().local_date < new Date(t0).toISOString().slice(0, 10)).toBe(true);
    const next = (
      await h.call('GET', `/sync/changes?after=${first.next_cursor}`, undefined, auth)
    ).json();
    expect(next.changes.some((c: { entity: string; key: string }) => c.entity === 'shift')).toBe(
      true,
    );
  });

  test('the phone total is explained as edited on the web, not as an engine disagreement', async () => {
    await setup({ end: false });
    await h.call(
      'POST',
      `/shifts/${SHIFT}/end`,
      {
        ended_at: endedAt,
        phone_result: {
          calc_version: 1,
          segmenter: 'stops',
          input_digest: '0123456789abcdef',
          total_m: 1,
          active_m: 1,
          deadhead_m: 0,
          personal_m: 0,
          trips_count: 1,
        },
      },
      auth,
    );
    const res = (await web('PATCH', `/shifts/${SHIFT}`, { ended_at: t0 + 100 * 5000 })).json();
    expect(res.calc_mismatch).toBe(false);
    expect(res.recon_reasons).toContain('edited_on_web');
    // A later Recalculate keeps saying so.
    const again = (await web('POST', `/shifts/${SHIFT}/recalculate`)).json();
    expect(again.recon_reasons).toContain('edited_on_web');
  });

  test('notes and times can travel together; no change to the times is not a recompute', async () => {
    await setup();
    const before = (await web('GET', `/shifts/${SHIFT}`)).json();
    const res = (
      await web('PATCH', `/shifts/${SHIFT}`, {
        notes: 'forgot to stop',
        started_at: before.started_at,
        ended_at: before.ended_at,
      })
    ).json();
    expect(res.notes).toBe('forgot to stop');
    expect(res.calculated_at).toBe(before.calculated_at);
  });

  test('refused: an end before the start, a future time, a running shift', async () => {
    await setup();
    const early = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: t0 - 1 });
    expect([early.statusCode, early.json().errors[0].path]).toEqual([422, '/ended_at']);
    const late = await web('PATCH', `/shifts/${SHIFT}`, { started_at: endedAt + 1 });
    expect([late.statusCode, late.json().errors[0].path]).toEqual([422, '/ended_at']);
    const future = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: h.clock.t + 3_600_000 });
    expect([future.statusCode, future.json().errors[0].path]).toEqual([422, '/ended_at']);
    expect((await web('GET', `/shifts/${SHIFT}`)).json().ended_at).toBe(endedAt);
    await h.close();

    await setup({ end: false });
    const active = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: endedAt });
    expect([active.statusCode, active.json().code]).toEqual([409, 'shift_not_ended']);
  });

  test('refused: a finalized shift, an unknown shift, a phone', async () => {
    await setup();
    expect(
      (await h.call('PATCH', `/shifts/${SHIFT}`, { ended_at: t0 + 60_000 }, auth)).statusCode,
    ).toBe(403);
    await web('POST', `/shifts/${SHIFT}/finalize`);
    const done = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: t0 + 60_000 });
    expect([done.statusCode, done.json().code]).toEqual([409, 'shift_finalized']);
    const none = await web('PATCH', '/shifts/9999', { ended_at: t0 + 60_000 });
    expect([none.statusCode, none.json().code]).toEqual([404, 'shift_not_found']);
  });

  test('refused with nothing changed when the raw points are archived', async () => {
    await setup();
    h.db
      .prepare(
        "INSERT INTO route_archives (shift_id, user_id, geometry, raw_point_count, kept_point_count, tolerance_m, archived_at) VALUES (1, 1, '{}', 1, 1, 5, 1)",
      )
      .run();
    const res = await web('PATCH', `/shifts/${SHIFT}`, { notes: 'x', ended_at: t0 + 100 * 5000 });
    expect([res.statusCode, res.json().code]).toEqual([409, 'not_recomputable']);
    const row = (await web('GET', `/shifts/${SHIFT}`)).json();
    expect([row.ended_at, row.notes]).toEqual([endedAt, null]);
  });

  test('with tracking off the times move and the totals stay the stored trips', async () => {
    await setup({ end: false, modules: TRACKING_OFF });
    await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
    const res = await web('PATCH', `/shifts/${SHIFT}`, { ended_at: endedAt - 60_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().ended_at).toBe(endedAt - 60_000);
  });
});

describe('a shift stuck active (spec 001 A3)', () => {
  test('the web can end it now; then it can be deleted', async () => {
    await setup({ end: false });
    expect((await web('DELETE', `/shifts/${SHIFT}?confirm_recent=true`)).json().code).toBe(
      'shift_not_ended',
    );
    const ended = await web('POST', `/shifts/${SHIFT}/end`, { ended_at: h.clock.t });
    expect([ended.statusCode, ended.json().status]).toEqual([200, 'ended']);
    expect((await web('DELETE', `/shifts/${SHIFT}?confirm_recent=true`)).statusCode).toBe(204);
    expect(count('SELECT count(*) FROM shifts')).toBe(0);
  });

  test('end before the start is refused', async () => {
    await setup({ end: false });
    const res = await web('POST', `/shifts/${SHIFT}/end`, { ended_at: t0 - 1 });
    expect([res.statusCode, res.json().errors[0].path]).toEqual([422, '/ended_at']);
  });
});
