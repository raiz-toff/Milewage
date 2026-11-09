import { algorithmVersion } from '@milewage/track-engine';
import { json, makeServices, mockServer, problem, SETTINGS, type Recorded } from './support/mock';
import { openNodeAppDb } from './support/nodeSql';
import { FakeTracker } from '../src/tracker/fake';

const sid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const DAY = 86_400_000;
const BASE = 1_700_000_000_000;

interface Shift {
  id: number;
  client_id: string;
  status: 'active' | 'ended' | 'finalized';
  started_at: number;
  ended?: Record<string, unknown>;
}
interface State {
  shifts: Map<string, Shift>;
  points: Map<string, Set<number>>;
  odometer: Map<string, number>;
}
const copy = (s: State): State => ({
  shifts: new Map([...s.shifts].map(([k, v]) => [k, { ...v }])),
  points: new Map([...s.points].map(([k, v]) => [k, new Set(v)])),
  odometer: new Map(s.odometer),
});

/**
 * A MileWage server as far as 08 goes for this: shifts by `client_id` (200 unchanged when known,
 * one active shift per user), points by seq with duplicates counted, `end` answered from the stored
 * result once ended. `backup` and `restore` copy its data; a restore raises the generation.
 */
function restorableServer() {
  let state: State = { shifts: new Map(), points: new Map(), odometer: new Map() };
  const counts = { duplicates: 0, inserted: 0, conflicts: 0 };
  const srv = {
    gen: 1,
    down: false,
    /** Called with each telemetry request before it is answered; may change the server. */
    onBatch: null as null | ((shift: string, seqs: number[]) => Response | void),
    /** Called after a telemetry batch was stored, before it is answered (a restore in between). */
    afterBatch: null as null | ((shift: string) => void),
    counts,
    get state() {
      return state;
    },
    backup: () => copy(state),
    restore: (snap: State) => {
      state = copy(snap);
      srv.gen += 1;
    },
  };
  const h = () => ({ 'X-MileWage-Instance': 'inst-A', 'X-MileWage-Restore-Gen': String(srv.gen) });
  const ok = (status: number, body: unknown) => json(status, body, h());
  const no = (status: number, code: string, retryable = false) =>
    problem(status, code, retryable, h());
  const result = (s: Shift) => {
    const total = (s.ended?.phone_result as { total_m?: number } | undefined)?.total_m ?? 0;
    return {
      id: s.id,
      status: s.status,
      total_m: total,
      active_m: total,
      deadhead_m: 0,
      personal_m: 0,
      calc_version: algorithmVersion,
      recon: { status: 'match', server_total_m: total, diff_m: 0, reasons: [] },
    };
  };

  const handle = (r: Recorded): Response => {
    const [, a, b, c, d] = r.path.split('/');
    if (r.method === 'GET' && a === 'settings') return ok(200, SETTINGS);
    if (r.method === 'GET' && a === 'sync')
      return ok(200, { changes: [], next_cursor: 0, has_more: false });
    if (r.method === 'POST' && a === 'shifts' && !b) {
      const body = r.body as { client_id: string; started_at: number };
      const same = state.shifts.get(body.client_id);
      if (same) return ok(200, result(same));
      if ([...state.shifts.values()].some((s) => s.status === 'active')) {
        counts.conflicts++;
        return no(409, 'shift_already_active');
      }
      const s: Shift = {
        id: state.shifts.size + 100,
        client_id: body.client_id,
        status: 'active',
        started_at: body.started_at,
      };
      state.shifts.set(s.client_id, s);
      return ok(201, result(s));
    }
    if (r.method === 'POST' && a === 'telemetry') {
      const body = r.body as { shift_client_id: string; points: { seq: number }[] };
      const seqs = body.points.map((p) => p.seq);
      const early = srv.onBatch?.(body.shift_client_id, seqs);
      if (early) return early;
      if (!state.shifts.has(body.shift_client_id)) return no(404, 'shift_not_found');
      const set = state.points.get(body.shift_client_id) ?? new Set<number>();
      state.points.set(body.shift_client_id, set);
      let inserted = 0;
      for (const q of seqs) {
        if (set.has(q)) counts.duplicates++;
        else inserted++;
        set.add(q);
      }
      counts.inserted += inserted;
      const res = {
        inserted,
        duplicates: seqs.length - inserted,
        rejected: [],
        server_time: 1,
        upload_hint_s: 60,
      };
      // A restore right after this batch was stored: the answer already carries the new generation.
      srv.afterBatch?.(body.shift_client_id);
      return ok(200, res);
    }
    const shift = state.shifts.get(b ?? '');
    if (a === 'shifts' && b) {
      if (!shift) return no(404, 'shift_not_found');
      if (r.method === 'POST' && c === 'end') {
        if (shift.status === 'active') {
          shift.status = 'ended';
          shift.ended = r.body as Record<string, unknown>;
        }
        return ok(200, result(shift)); // ended already: the stored result, unchanged
      }
      if (r.method === 'PUT' && c === 'odometer') {
        state.odometer.set(`${b}:${d}`, (r.body as { reading_m: number }).reading_m);
        return ok(200, {});
      }
      if (r.method === 'PUT') return ok(200, {});
    }
    return no(404, 'not_found');
  };

  const routes = new Proxy({}, { get: () => handle }) as Record<string, (r: Recorded) => Response>;
  const mock = mockServer(routes);
  return Object.assign(srv, {
    calls: mock.calls,
    fetch: (url: string, init: RequestInit) =>
      srv.down ? Promise.reject(new TypeError('offline')) : mock.fetch(url, init),
  });
}

type Srv = ReturnType<typeof restorableServer>;

/** A paired phone on `srv`; `db` lets a second instance (an app restart) open the same app.db. */
function phone(
  srv: Srv,
  over: { db?: ReturnType<typeof openNodeAppDb>; tracker?: FakeTracker } = {},
) {
  const clock = { t: BASE };
  let n = 0;
  const tracker = over.tracker ?? new FakeTracker(() => clock.t);
  const db = over.db ?? openNodeAppDb();
  const { services } = makeServices(srv.fetch, {
    paired: true,
    tracker,
    now: () => clock.t,
    newId: () => sid(n++),
    openAppDb: async () => db,
  });
  return { services, tracker, clock, db };
}

/** Records one shift of `points` fixes on day `day` and ends it (online: it reaches the server). */
async function record(p: ReturnType<typeof phone>, day: number, points: number, odometerM = 0) {
  p.clock.t = BASE + day * DAY;
  await p.services.shift.start({ vehicleId: 3, odometerStartM: odometerM || null });
  for (let j = 0; j < points; j++) {
    p.tracker.emit({
      recordedAt: p.clock.t + 1_000 + j * 10_000,
      latE7: 400_000_000 + j * 3_000,
      lonE7: 0,
    });
  }
  p.clock.t += points * 10_000 + 5_000;
  await p.services.shift.end();
  await p.services.sender.sendNow();
}

const states = async (p: ReturnType<typeof phone>) =>
  Object.fromEntries((await p.services.shifts.list()).map((s) => [s.client_id, s.sync_state]));
const resendRows = async (p: ReturnType<typeof phone>) =>
  (
    await p.db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM sync_state WHERE key LIKE 'resend:%' ORDER BY key",
    )
  ).map((r) => ({ id: r.key.slice(7), ...(JSON.parse(r.value) as object) }));
const telemetryFor = (srv: Srv, id: string, from = 0) =>
  srv.calls
    .slice(from)
    .filter((c) => c.path === '/telemetry/batch')
    .filter((c) => (c.body as { shift_client_id: string }).shift_client_id === id)
    .reduce((a, c) => a + (c.body as { points: unknown[] }).points.length, 0);

describe('sending again after the server was restored (15 section 9.3)', () => {
  it('a restore from before two shifts: both are sent again with their points, then "on server"', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 300, 120_000_000);
    await record(p, 1, 700);
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(1)]: 'on_server' });

    srv.restore(empty); // the server lost both shifts
    expect(await p.services.sender.sendNow()).toBe(true);

    expect([...srv.state.shifts.values()].map((s) => [s.client_id, s.status])).toEqual([
      [sid(0), 'ended'],
      [sid(1), 'ended'],
    ]);
    expect(srv.state.points.get(sid(0))?.size).toBe(300);
    expect(srv.state.points.get(sid(1))?.size).toBe(700);
    expect(srv.state.odometer.get(`${sid(0)}:shift_start`)).toBe(120_000_000);
    // `end` again with the manifest and the phone's result, after every point (the barrier).
    expect(srv.state.shifts.get(sid(1))?.ended).toMatchObject({
      manifest: { point_count: 700 },
      phone_result: { calc_version: algorithmVersion },
    });
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(1)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
    expect((await p.services.sender.status()).message).toBeNull();
  });

  it('a shift the restore kept is answered as it is: nothing is doubled', async () => {
    const srv = restorableServer();
    const p = phone(srv);
    await record(p, 0, 400);
    const withFirst = srv.backup(); // taken after the first shift reached the server
    await record(p, 1, 200);

    srv.restore(withFirst);
    await p.services.sender.sendNow();

    expect(srv.state.shifts.size).toBe(2); // the kept shift was not created a second time
    expect(srv.state.points.get(sid(0))?.size).toBe(400);
    expect(srv.state.points.get(sid(1))?.size).toBe(200);
    expect(srv.counts.duplicates).toBe(400); // the kept points came back as duplicates
    expect(srv.counts.conflicts).toBe(0);
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(1)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });

  it('a connection lost halfway: the next sync goes on from the last batch accepted', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 1_200);
    srv.restore(empty);
    let batches = 0;
    srv.onBatch = () => (++batches === 2 ? problem(503, 'unavailable', true) : undefined);

    expect(await p.services.sender.sendNow()).toBe(false);
    expect(srv.state.points.get(sid(0))?.size).toBe(500);
    expect(await resendRows(p)).toEqual([{ id: sid(0), gen: 2, phase: 'todo', after: 500 }]);
    expect(await states(p)).toEqual({ [sid(0)]: 'local' });
    // Still held: the notice stays, and no `end` before the points.
    expect((await p.services.sender.status()).message).toMatch(/re-sending the last 14 days/);
    expect(srv.state.shifts.get(sid(0))?.status).toBe('active');

    srv.onBatch = null;
    const from = srv.calls.length;
    await p.services.sender.sendNow();
    expect(telemetryFor(srv, sid(0), from)).toBe(700); // only what was not accepted yet
    expect(srv.state.points.get(sid(0))?.size).toBe(1_200);
    expect(srv.state.shifts.get(sid(0))?.status).toBe('ended');
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });

  it('offline: everything stays on the phone, survives an app restart, and goes when the server is back', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 250);
    srv.restore(empty);
    // The restore is seen on the settings answer; then the connection drops.
    await p.services.pairing.refreshSettings((await p.services.pairing.load())!);
    expect((await p.services.sender.status()).message).toMatch(/restored from a backup/);
    srv.down = true;

    expect(await p.services.sender.sendNow()).toBe(false);
    expect(await states(p)).toEqual({ [sid(0)]: 'local' });
    expect(await resendRows(p)).toEqual([{ id: sid(0), gen: 2, phase: 'todo', after: 0 }]);

    // The app is closed and opened again: the rows are in app.db, so the notice is back at once.
    const again = phone(srv, { db: p.db, tracker: p.tracker });
    expect((await again.services.sender.status()).message).toMatch(/restored from a backup/);

    srv.down = false;
    await again.services.sender.sendNow();
    expect(srv.state.points.get(sid(0))?.size).toBe(250);
    expect(await states(again)).toEqual({ [sid(0)]: 'on_server' });
    expect((await again.services.sender.status()).message).toBeNull();
  });

  it('a second restore while sending again starts over, and both shifts end up on the server', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 300);
    await record(p, 1, 900);
    srv.restore(empty);
    // The first shift is sent again in full; then, after the second shift's first batch, the
    // server is restored once more from the same empty backup.
    let restoredTwice = false;
    srv.afterBatch = (shift) => {
      if (restoredTwice || shift !== sid(1)) return;
      restoredTwice = true;
      srv.restore(empty);
    };

    const r = await p.services.sender.sendNow();

    expect(restoredTwice).toBe(true);
    expect(r).toBe(true);
    expect(srv.gen).toBe(3);
    expect(srv.state.points.get(sid(0))?.size).toBe(300);
    expect(srv.state.points.get(sid(1))?.size).toBe(900);
    expect([...srv.state.shifts.values()].every((s) => s.status === 'ended')).toBe(true);
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(1)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });

  it('the running shift is sent again first; ended shifts wait until it ends, their points kept meanwhile', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 100);
    p.clock.t = BASE + 2 * DAY;
    await p.services.shift.start({ vehicleId: 3 });
    for (let j = 0; j < 50; j++) {
      p.tracker.emit({
        recordedAt: p.clock.t + 1_000 + j * 1_000,
        latE7: 400_000_000 + j * 3_000,
        lonE7: 0,
      });
    }
    p.clock.t += 60_000;
    await p.services.sender.sendNow(); // the running shift's points reach the server
    expect(srv.state.points.get(sid(1))?.size).toBe(50);

    // Weeks later: the phone would let go of points the server acknowledged 14 days ago, but not
    // while a restore still asks for them.
    p.clock.t = BASE + 20 * DAY;
    srv.restore(empty);
    await p.services.sender.sendNow();
    expect(srv.state.shifts.get(sid(1))?.status).toBe('active');
    expect(srv.state.points.get(sid(1))?.size).toBe(50);
    expect(srv.state.shifts.has(sid(0))).toBe(false); // waits: it would be a second active shift
    expect(await resendRows(p)).toEqual([{ id: sid(0), gen: 2, phase: 'todo', after: 0 }]);

    await p.services.shift.end();
    await p.services.sender.sendNow();
    expect(srv.counts.conflicts).toBe(0);
    expect(srv.state.points.get(sid(0))?.size).toBe(100);
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(1)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });

  it('a shift known only from the server feed is not sent and stays "on server"', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    await record(p, 0, 50);
    await p.db.runAsync(
      `INSERT INTO shifts (client_id, server_id, vehicle_id, status, segmenter, started_at, ended_at, local_date,
         total_m, calc_source, updated_at, sync_state)
       VALUES (?, 9, 3, 'ended', 'whole_shift', ?, ?, '2023-11-10', 5000, 'server', 1, 'on_server')`,
      sid(9),
      BASE - DAY,
      BASE - DAY + 3_600_000,
    );
    srv.restore(empty);
    await p.services.sender.sendNow();
    const created = srv.calls
      .filter((c) => c.method === 'POST' && c.path === '/shifts')
      .map((c) => (c.body as { client_id: string }).client_id);
    expect(created).not.toContain(sid(9));
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server', [sid(9)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });

  it('work queued before the restore waits until the server has the shift again (never parked)', async () => {
    const srv = restorableServer();
    const empty = srv.backup();
    const p = phone(srv);
    p.clock.t = BASE;
    await p.services.shift.start({ vehicleId: 3 }); // created on the server
    for (let j = 0; j < 80; j++) {
      p.tracker.emit({
        recordedAt: p.clock.t + 1_000 + j * 10_000,
        latE7: 400_000_000 + j * 3_000,
        lonE7: 0,
      });
    }
    p.clock.t += 900_000;
    srv.down = true; // ended offline: points, end odometer and `end` stay queued
    await p.services.shift.end({ odometerEndM: 120_050_000 });
    await p.services.sender.sendNow();
    srv.down = false;

    srv.restore(empty);
    await p.services.pairing.refreshSettings((await p.services.pairing.load())!);
    const from = srv.calls.length;
    await p.services.sender.sendNow();
    // The shift is created again before the reading and the end that waited for it.
    const sent = srv.calls.slice(from).map((c) => `${c.method} ${c.path}`);
    expect(sent.indexOf('POST /shifts')).toBeLessThan(
      sent.indexOf(`PUT /shifts/${sid(0)}/odometer/shift_end`),
    );
    expect(srv.state.points.get(sid(0))?.size).toBe(80);
    expect(srv.state.odometer.get(`${sid(0)}:shift_end`)).toBe(120_050_000);
    expect(srv.state.shifts.get(sid(0))?.status).toBe('ended');
    expect((await p.services.sender.status()).color).toBe('green'); // nothing parked
    expect(await states(p)).toEqual({ [sid(0)]: 'on_server' });
    expect(await resendRows(p)).toEqual([]);
  });
});
