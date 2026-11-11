import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { processShift } from '@milewage/track-engine';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

type Entry = {
  seq: number;
  entity: string;
  op: string;
  key: string;
  data: Record<string, unknown> | null;
};
let h: Harness;
let cookie: string;
let auth: { authorization: string };
let t0: number;
let endedAt: number;

const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
const pull = async (after = 0, limit?: number, headers: object = auth) =>
  h.call(
    'GET',
    `/sync/changes?after=${after}${limit ? `&limit=${limit}` : ''}`,
    undefined,
    headers,
  );
const all = async (after = 0, headers: object = auth) =>
  (await pull(after, undefined, headers)).json();
const count = (table: string) => h.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

async function runShift() {
  t0 = h.clock.t;
  const fixes = ride(t0);
  endedAt = t0 + 313 * 5000;
  h.clock.t = endedAt + 60_000;
  await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
  for (let i = 0; i < fixes.length; i += 100) {
    const points = fixes.slice(i, i + 100).map(toWire);
    await h.call('POST', '/telemetry/batch', { shift_client_id: SHIFT, points }, auth);
  }
  await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
  return fixes;
}

beforeEach(async () => {
  h = harness();
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
});
afterEach(() => h.close());

describe('GET /sync/changes (15 section 6.5)', () => {
  test('the pull carries the current state of every changed entity, in cursor order', async () => {
    const fixes = await runShift();
    const body = await all();
    const kinds = body.changes.map((c: Entry) => `${c.entity}:${c.op}`);
    expect(kinds).toContain('vehicle:upsert');
    expect(kinds).toContain('shift:upsert');
    expect(kinds.filter((k: string) => k === 'trip:upsert').length).toBe(
      processShift({ shiftClientId: SHIFT, startedAt: t0, endedAt, fixes, segmenter: 'stops' })
        .trips.length,
    );
    const seqs = body.changes.map((c: Entry) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(body.next_cursor).toBe(seqs.at(-1));
    expect(body.has_more).toBe(false);
    // Entries hold the entity as the API shows it, as of now (the ended shift, not the started one).
    const shift = body.changes.find((c: Entry) => c.entity === 'shift') as Entry;
    expect(shift.key).toBe(SHIFT);
    expect(shift.data).toMatchObject({
      client_id: SHIFT,
      status: 'ended',
      total_m: expect.any(Number),
    });
    const trip = body.changes.find((c: Entry) => c.entity === 'trip') as Entry;
    expect(trip.data).toMatchObject({ trip_key: trip.key, source: 'auto' });
    // Nothing new since the cursor.
    expect(await all(body.next_cursor)).toEqual({
      changes: [],
      next_cursor: body.next_cursor,
      has_more: false,
    });
  });

  test('cursor paging: limit, has_more and resuming from next_cursor see every entry once', async () => {
    await runShift();
    await web('PATCH', `/shifts/${SHIFT}`, { notes: 'rainy' });
    const full = await all();
    const seen: Entry[] = [];
    let cursor = 0;
    for (let i = 0; i < 20; i++) {
      const page = (await pull(cursor, 2)).json();
      expect(page.changes.length).toBeLessThanOrEqual(2);
      seen.push(...page.changes);
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    // Paging 2 at a time visits the same final states as one big pull.
    const last = (rows: Entry[]) => new Map(rows.map((r) => [`${r.entity}/${r.key}`, r.data]));
    expect(last(seen)).toEqual(last(full.changes));
    expect(cursor).toBe(full.next_cursor);
  });

  test('a web edit shows up as a change to the shift; a vehicle and the settings too', async () => {
    await runShift();
    const cursor = (await all()).next_cursor;
    await web('PATCH', `/shifts/${SHIFT}`, { notes: 'rainy' });
    await web('PATCH', '/settings', { distance_unit: 'km' });
    await web('PATCH', '/vehicles/1', { name: 'Accord' });
    const after = (await all(cursor)).changes as Entry[];
    expect(after.map((c) => `${c.entity}:${c.key}`).sort()).toEqual(
      [
        `shift:${SHIFT}`,
        'settings:settings',
        'vehicle:1',
        ...after.filter((c) => c.entity === 'trip').map((c) => `trip:${c.key}`),
      ].sort(),
    );
    expect(after.find((c) => c.entity === 'shift')!.data).toMatchObject({ notes: 'rainy' });
    expect(after.find((c) => c.entity === 'settings')!.data).toMatchObject({ distance_unit: 'km' });
    expect(after.find((c) => c.entity === 'vehicle')!.data).toMatchObject({ name: 'Accord' });
  });

  test('deletes are tombstones: a removed odometer reading and trips that a label recompute removed', async () => {
    const fixes = await runShift();
    const reading = (
      await web('POST', '/odometer', {
        vehicle_id: 1,
        kind: 'year_start',
        reading_m: 5,
        recorded_at: t0 - 1000,
      })
    ).json();
    const cursor = (await all()).next_cursor;
    await web('DELETE', `/odometer/${reading.id}`);
    // Labelling the stop as a dropoff changes where the trips are cut, so some keys vanish.
    const stop = processShift({
      shiftClientId: SHIFT,
      startedAt: t0,
      endedAt,
      fixes,
      segmenter: 'stops',
    }).stops[0]!;
    const before = new Set(h.db.prepare('SELECT trip_key FROM trips').pluck().all() as string[]);
    await web('PUT', `/shifts/${SHIFT}/stop-labels/${encodeURIComponent(stop.stopKey)}`, {
      role: 'dropoff',
      edited_at: h.clock.t,
    });
    const now = new Set(h.db.prepare('SELECT trip_key FROM trips').pluck().all() as string[]);
    const removed = [...before].filter((k) => !now.has(k));
    expect(removed.length).toBeGreaterThan(0);
    const changes = (await all(cursor)).changes as Entry[];
    expect(changes.find((c) => c.entity === 'odometer')).toMatchObject({
      op: 'delete',
      key: String(reading.id),
      data: null,
    });
    for (const key of removed) {
      expect(changes.find((c) => c.entity === 'trip' && c.key === key)).toMatchObject({
        op: 'delete',
        data: null,
      });
    }
    for (const key of now) {
      expect(changes.find((c) => c.entity === 'trip' && c.key === key)).toMatchObject({
        op: 'upsert',
      });
    }
  });

  test('the phone sees its 14 day window and shifts it wrote to; the web sees everything', async () => {
    await runShift();
    h.clock.t += 20 * 24 * 3600_000;
    h.db.prepare('UPDATE shifts SET device_touched_at = NULL').run();
    const keys = (b: { changes: Entry[] }) => b.changes.map((c) => c.entity);
    expect(keys(await all(0, auth))).not.toContain('shift');
    expect(keys(await all(0, auth))).not.toContain('trip');
    expect(keys(await all(0, auth))).toContain('vehicle'); // not tied to a shift
    expect(keys(await all(0, { cookie }))).toContain('shift');
    // A device that wrote to the old shift reads it back.
    h.db.prepare('UPDATE shifts SET device_touched_at = ?').run(h.clock.t - 1000);
    expect(keys(await all(0, auth))).toContain('shift');
  });

  test('410 cursor_expired after pruning, and for a cursor ahead of the log (restore)', async () => {
    await runShift();
    const full = await all();
    // Entries older than 30 days are pruned by the daily job.
    h.clock.t += 20 * 24 * 3600_000;
    await web('PATCH', '/settings', { distance_unit: 'km' }); // an entry from 11 days before the prune
    h.clock.t += 11 * 24 * 3600_000;
    h.db.prepare('DELETE FROM change_log WHERE at < ?').run(h.clock.t - 30 * 24 * 3600_000);
    const expired = await pull(1);
    expect([expired.statusCode, expired.json().code]).toEqual([410, 'cursor_expired']);
    expect((await pull(0)).statusCode).toBe(200);
    expect((await pull(full.next_cursor + 1000)).json().code).toBe('cursor_expired');
    // A cursor right before the oldest kept entry lost nothing.
    const first = h.db.prepare('SELECT min(seq) FROM change_log').pluck().get() as number;
    expect((await pull(first - 1)).statusCode).toBe(200);
  });

  test('overwrite_log keeps the value a newer edit replaced', async () => {
    await runShift();
    await web('PATCH', `/shifts/${SHIFT}`, { notes: 'typed on the web' });
    const edit = await h.call(
      'PATCH',
      `/shifts/${SHIFT}`,
      { notes: 'typed on the phone', updated_at: h.clock.t + 5000 },
      auth,
    );
    expect(edit.headers['x-milewage-applied']).toBe('true');
    const row = h.db.prepare('SELECT * FROM overwrite_log ORDER BY id DESC').get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({ entity: 'shift', key: SHIFT, by_device_id: 1 });
    expect(JSON.parse(String(row.superseded_json))).toMatchObject({ notes: 'typed on the web' });
    // A stale edit overwrites nothing and logs nothing.
    await h.call('PATCH', `/shifts/${SHIFT}`, { notes: 'old', updated_at: 1 }, auth);
    expect(count('overwrite_log')).toBe(2); // the web edit (null notes replaced) and the phone edit
  });

  test('access: a session or a phone, nobody else; validation', async () => {
    expect((await h.call('GET', '/sync/changes')).json().code).toBe('auth_required');
    expect((await pull(0, undefined, { cookie })).statusCode).toBe(200);
    expect((await h.call('GET', '/sync/changes?after=-1', undefined, auth)).statusCode).toBe(422);
    expect((await h.call('GET', '/sync/changes?limit=500', undefined, auth)).statusCode).toBe(422);
    expect((await h.call('GET', '/sync/changes?colour=red', undefined, auth)).statusCode).toBe(422);
  });
});

describe('module off', () => {
  test('sync off: the route is 404 and nothing is written to the log', async () => {
    await h.close();
    h = harness({ sync: false });
    ({ cookie } = await h.signUp());
    await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
    ({ auth } = await h.pair(cookie));
    await runShift();
    await web('PATCH', `/shifts/${SHIFT}`, { notes: 'x' });
    expect((await pull()).json().code).toBe('not_found');
    expect(count('change_log')).toBe(0);
    expect(count('overwrite_log')).toBe(0);
  });
});
