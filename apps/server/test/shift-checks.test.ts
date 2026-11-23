import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ride, toWire } from './rides';
import { harness, type Harness } from './support';

// Spec 001 C1 to C3: a very short shift, an overlap and a stale active shift. All are flags: nothing is refused.

const MIN = 60_000;
const HOUR = 3_600_000;

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const shift = async (ref: string | number) => (await web('GET', `/shifts/${ref}`)).json();
const flag = (
  s: { flags: { code: string; severity: string; detail: { detail: string | null } | null }[] },
  c: string,
) => s.flags.find((f) => f.code === c);

/** A shift that has ended; `from` and `to` are offsets from t0. */
async function ended(i: number, from: number, to: number) {
  const started = await h.call(
    'POST',
    '/shifts',
    { client_id: uuid(i), vehicle_id: 1, started_at: t0 + from },
    auth,
  );
  expect(started.statusCode).toBe(201);
  const end = await h.call('POST', `/shifts/${uuid(i)}/end`, { ended_at: t0 + to }, auth);
  expect(end.statusCode).toBe(200);
  return end.json();
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  t0 = h.clock.t;
  h.clock.t = t0 + 24 * HOUR; // all these shifts are in the past
});
afterEach(() => h.close());

describe('very short shift (C1)', () => {
  test('119 s is flagged, 120 s is not', async () => {
    expect(flag(await ended(1, 0, 119_000), 'very_short_shift')?.severity).toBe('info');
    expect(flag(await ended(2, HOUR, HOUR + 120_000), 'very_short_shift')).toBeUndefined();
  });

  test('159 m is flagged, 160 m is not (set on the stored total, then Reviewed)', async () => {
    for (const [i, m, expected] of [
      [1, 159, true],
      [2, 160, false],
    ] as const) {
      const s = await ended(i, i * HOUR, i * HOUR + 60_000);
      h.db.prepare('UPDATE shifts SET total_m = ? WHERE id = ?').run(m, s.id);
      const done = (await web('POST', `/shifts/${s.id}/finalize`)).json();
      expect(flag(done, 'very_short_shift') !== undefined, `${m} m`).toBe(expected);
    }
  });

  test('earnings, a parking or toll cost, an expense or a manual trip make it ordinary', async () => {
    const earned = await ended(1, 0, 60_000);
    h.db
      .prepare(
        "INSERT INTO shift_earnings (user_id, shift_id, platform, edited_at) VALUES (1, ?, 'other', 0)",
      )
      .run(earned.id);
    expect(
      flag((await web('POST', `/shifts/${earned.id}/finalize`)).json(), 'very_short_shift'),
    ).toBe(undefined);

    const costly = await ended(2, HOUR, HOUR + 60_000);
    h.db
      .prepare(
        "INSERT INTO expenses (user_id, spent_on, category, amount_cents, shift_id, created_at, updated_at) VALUES (1, '2027-01-15', 'parking', 300, ?, 0, 0)",
      )
      .run(costly.id);
    expect(
      flag((await web('POST', `/shifts/${costly.id}/finalize`)).json(), 'very_short_shift'),
    ).toBe(undefined);

    const manual = await ended(3, 2 * HOUR, 2 * HOUR + 60_000);
    const trip = await web('PUT', `/shifts/${manual.id}/trips/${uuid(99)}`, {
      distance_m: 10,
      edited_at: h.clock.t,
      purpose: 'Business driving',
      kind: 'active',
      started_at: t0 + 2 * HOUR,
      ended_at: t0 + 2 * HOUR + 60_000,
    });
    expect(trip.statusCode).toBeLessThan(300);
    expect(flag(await shift(manual.id), 'very_short_shift')).toBeUndefined();
  });

  test('a running shift is never flagged', async () => {
    const s = await h.call(
      'POST',
      '/shifts',
      { client_id: uuid(1), vehicle_id: 1, started_at: h.clock.t - 30_000 },
      auth,
    );
    expect(flag(s.json(), 'very_short_shift')).toBeUndefined();
  });
});

describe('overlap (C2)', () => {
  test('a shift that starts inside another is flagged, naming it; nothing is refused', async () => {
    const a = await ended(1, 0, HOUR);
    const b = await ended(2, 30 * MIN, 90 * MIN);
    expect(b.overlaps_shift_id).toBe(a.id);
    const f = flag(b, 'shift_overlap');
    expect(f?.severity).toBe('review');
    expect(f?.detail?.detail).toBe(String(a.id));
    expect(flag(await shift(a.id), 'shift_overlap')).toBeUndefined();
  });

  test('back to back (end equals start) is not an overlap', async () => {
    await ended(1, 0, HOUR);
    const b = await ended(2, HOUR, 2 * HOUR);
    expect(b.overlaps_shift_id).toBeNull();
    expect(flag(b, 'shift_overlap')).toBeUndefined();
  });

  test('a shift inside another (containment) is flagged', async () => {
    const a = await ended(1, 0, 3 * HOUR);
    const b = await ended(2, HOUR, 2 * HOUR);
    expect(b.overlaps_shift_id).toBe(a.id);
  });

  test('a running shift counts as ending now', async () => {
    const a = await ended(1, 0, HOUR);
    const run = await h.call(
      'POST',
      '/shifts',
      { client_id: uuid(2), vehicle_id: 1, started_at: t0 + 30 * MIN },
      auth,
    );
    expect(run.json().overlaps_shift_id).toBe(a.id);
  });

  test('editing the times so they no longer overlap clears the flag and the column', async () => {
    await ended(1, 0, HOUR);
    const b = await ended(2, 30 * MIN, 90 * MIN);
    const moved = await web('PATCH', `/shifts/${b.id}`, { started_at: t0 + HOUR });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().overlaps_shift_id).toBeNull();
    expect(flag(await shift(b.id), 'shift_overlap')).toBeUndefined();
    // and a retime into an overlap sets it
    const back = await web('PATCH', `/shifts/${b.id}`, { started_at: t0 + 10 * MIN });
    expect(back.json().overlaps_shift_id).not.toBeNull();
    expect(flag(await shift(b.id), 'shift_overlap')).toBeDefined();
  });

  test('retiming the other shift away clears the one that named it', async () => {
    const a = await ended(1, 0, HOUR);
    const b = await ended(2, 30 * MIN, 90 * MIN);
    await web('PATCH', `/shifts/${a.id}`, { ended_at: t0 + 20 * MIN });
    expect((await shift(b.id)).overlaps_shift_id).toBeNull();
  });

  test('deleting the other shift clears the flag', async () => {
    const a = await ended(1, 0, HOUR);
    const b = await ended(2, 30 * MIN, 90 * MIN);
    const gone = await web('DELETE', `/shifts/${a.id}?confirm_recent=true`);
    expect(gone.statusCode).toBe(204);
    const after = await shift(b.id);
    expect(after.overlaps_shift_id).toBeNull();
    expect(flag(after, 'shift_overlap')).toBeUndefined();
  });

  test('the flag survives a recalculation', async () => {
    await ended(1, 0, HOUR);
    const b = await ended(2, 30 * MIN, 90 * MIN);
    await web('POST', `/shifts/${b.id}/recalculate`);
    expect(flag(await shift(b.id), 'shift_overlap')).toBeDefined();
  });
});

describe('stale active shift (C3)', () => {
  test('no point for 12 hours flags a running shift; the server never ends it', async () => {
    h.clock.t = t0;
    await h.call('POST', '/shifts', { client_id: uuid(1), vehicle_id: 1, started_at: t0 }, auth);
    h.clock.t = t0 + 12 * HOUR - 1;
    expect(flag(await shift(uuid(1)), 'stale_active_shift')).toBeUndefined();
    h.clock.t = t0 + 12 * HOUR;
    const s = await shift(uuid(1));
    expect(flag(s, 'stale_active_shift')?.severity).toBe('review');
    expect(s.status).toBe('active');
  });

  test('the newest point restarts the 12 hours', async () => {
    h.clock.t = t0;
    await h.call('POST', '/shifts', { client_id: uuid(1), vehicle_id: 1, started_at: t0 }, auth);
    const first = ride(t0)[0]!;
    const at = t0 + 5 * HOUR;
    h.clock.t = at;
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: uuid(1), points: [toWire({ ...first, recordedAt: at })] },
      auth,
    );
    h.clock.t = t0 + 12 * HOUR + 1000; // 12 h after the start, 7 h after the point
    expect(flag(await shift(uuid(1)), 'stale_active_shift')).toBeUndefined();
    h.clock.t = at + 12 * HOUR;
    expect(flag(await shift(uuid(1)), 'stale_active_shift')).toBeDefined();
  });

  test('an ended shift is never stale', async () => {
    const s = await ended(1, 0, HOUR);
    h.clock.t = t0 + 48 * HOUR;
    expect(flag(await shift(s.id), 'stale_active_shift')).toBeUndefined();
  });
});

describe('the phone discards a shift started by mistake (C1)', () => {
  test('a device can delete an ended shift with confirm_recent, never a running one', async () => {
    h.clock.t = t0 + 10 * MIN;
    await h.call('POST', '/shifts', { client_id: uuid(1), vehicle_id: 1, started_at: t0 }, auth);
    const running = await h.call(
      'DELETE',
      `/shifts/${uuid(1)}?confirm_recent=true`,
      undefined,
      auth,
    );
    expect(running.statusCode).toBe(409);
    expect(running.json().code).toBe('shift_not_ended');
    await h.call('POST', `/shifts/${uuid(1)}/end`, { ended_at: t0 + 40_000 }, auth);
    const unconfirmed = await h.call('DELETE', `/shifts/${uuid(1)}`, undefined, auth);
    expect(unconfirmed.statusCode).toBe(422);
    const gone = await h.call('DELETE', `/shifts/${uuid(1)}?confirm_recent=true`, undefined, auth);
    expect(gone.statusCode).toBe(204);
    expect((await web('GET', `/shifts/${uuid(1)}`)).statusCode).toBe(404);
  });
});
