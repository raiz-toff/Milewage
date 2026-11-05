import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const count = (table: string) => h.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
const OTHER = '11111111-2222-4333-8444-555555555555';

async function endedShift(clientId: string, startedAt: number, seqBase = 0) {
  const fixes = ride(startedAt);
  const endedAt = startedAt + 313 * 5000;
  await h.call(
    'POST',
    '/shifts',
    { client_id: clientId, vehicle_id: 1, started_at: startedAt },
    auth,
  );
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map((f) => ({ ...toWire(f), seq: f.seq + seqBase }));
    await h.call('POST', '/telemetry/batch', { shift_client_id: clientId, points }, auth);
  }
  await h.call(
    'PUT',
    `/shifts/${clientId}/odometer/shift_start`,
    { reading_m: 1000, recorded_at: startedAt },
    auth,
  );
  await h.call('POST', `/shifts/${clientId}/end`, { ended_at: endedAt }, auth);
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  const t0 = h.clock.t;
  h.clock.t = t0 + 2 * 3_600_000;
  await endedShift(SHIFT, t0);
});
afterEach(() => h.close());

describe('DELETE /shifts/{ref} (07 section 4.2)', () => {
  test('a young shift needs confirm_recent=true; then the shift and everything under it is gone', async () => {
    const stopKey = `${SHIFT}:${h.clock.t}:stop`;
    h.db
      .prepare(
        "INSERT INTO stop_labels (user_id, shift_id, stop_key, role, edited_at) VALUES (1, 1, ?, 'pickup', 1)",
      )
      .run(stopKey);
    const [trip] = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    await web('PATCH', `/trips/${trip.id}`, { kind: 'personal' });
    expect(count('trip_overrides')).toBe(1);
    expect(count('telemetry_points')).toBeGreaterThan(0);

    const refused = await web('DELETE', `/shifts/${SHIFT}`);
    expect([refused.statusCode, refused.json().errors[0].path]).toEqual([422, '/confirm_recent']);
    expect((await web('DELETE', `/shifts/${SHIFT}?confirm_recent=false`)).statusCode).toBe(422);
    expect(count('shifts')).toBe(1);

    const res = await web('DELETE', `/shifts/${SHIFT}?confirm_recent=true`);
    expect(res.statusCode).toBe(204);
    for (const t of [
      'shifts',
      'telemetry_points',
      'trips',
      'stops',
      'stop_labels',
      'shift_flags',
      'trip_overrides',
    ]) {
      expect([t, count(t)]).toEqual([t, 0]);
    }
    expect(count('odometer_readings')).toBe(0);
    expect((await web('GET', `/shifts/${SHIFT}`)).statusCode).toBe(404);
    expect((await web('DELETE', `/shifts/${SHIFT}?confirm_recent=true`)).statusCode).toBe(404);
  });

  test('a shift older than 7 years is deleted without confirmation; another shift is untouched', async () => {
    const start = h.clock.t + 3_600_000;
    h.clock.t = start + 40 * 60_000;
    await endedShift(OTHER, start, 1000);
    const eight = new Date(h.clock.t);
    eight.setUTCFullYear(eight.getUTCFullYear() - 8);
    h.db.prepare('UPDATE shifts SET started_at = ? WHERE id = 1').run(eight.getTime());
    const before = count('trips');
    expect((await web('DELETE', `/shifts/1`)).statusCode).toBe(204);
    expect(count('shifts')).toBe(1);
    expect(count('trips')).toBeLessThan(before as number);
    expect((await web('GET', `/shifts/${OTHER}`)).json().total_m).toBeGreaterThan(0);
  });

  test('an active shift, a phone and a signed-out caller are refused', async () => {
    const active = '22222222-3333-4444-8555-666666666666';
    h.clock.t += 3_600_000;
    await h.call(
      'POST',
      '/shifts',
      { client_id: active, vehicle_id: 1, started_at: h.clock.t },
      auth,
    );
    const res = await web('DELETE', `/shifts/${active}?confirm_recent=true`);
    expect([res.statusCode, res.json().code]).toEqual([409, 'shift_not_ended']);
    expect(
      (await h.call('DELETE', `/shifts/${SHIFT}?confirm_recent=true`, undefined, auth)).statusCode,
    ).toBe(403);
    expect((await h.call('DELETE', `/shifts/${SHIFT}?confirm_recent=true`)).statusCode).toBe(401);
  });

  test('the phone receives tombstones for the shift, its trips, its override and its reading', async () => {
    const [trip] = (await web('GET', `/shifts/${SHIFT}/trips`)).json();
    await web('PATCH', `/trips/${trip.id}`, { kind: 'personal' });
    const first = (await h.call('GET', '/sync/changes?after=0', undefined, auth)).json();
    const tripKeys = first.changes
      .filter((c: { entity: string }) => c.entity === 'trip')
      .map((c: { key: string }) => c.key);
    expect(tripKeys.length).toBeGreaterThan(0);
    await web('DELETE', `/shifts/${SHIFT}?confirm_recent=true`);
    const next = (
      await h.call('GET', `/sync/changes?after=${first.next_cursor}`, undefined, auth)
    ).json();
    const deletes = next.changes.filter((c: { op: string }) => c.op === 'delete');
    const keys = (entity: string) =>
      deletes
        .filter((c: { entity: string }) => c.entity === entity)
        .map((c: { key: string }) => c.key);
    expect(keys('shift')).toEqual([SHIFT]);
    expect(keys('trip').sort()).toEqual([...tripKeys].sort());
    expect(keys('override')).toEqual([trip.trip_key]);
    expect(keys('odometer')).toHaveLength(1);
    expect(deletes.every((c: { data: unknown }) => c.data === null)).toBe(true);
  });
});
