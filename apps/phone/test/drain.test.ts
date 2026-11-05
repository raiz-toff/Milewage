import { algorithmVersion } from '@milewage/track-engine';
import { json, makeServices, mockServer, problem, type Handler } from './support/mock';
import { FakeTracker } from '../src/tracker/fake';

const sid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const DAY = 86_400_000;
const BASE = 1_700_000_000_000;

/** A server that remembers what it was sent, in order, and refuses what 08 refuses. */
function recordingServer(n: number, over: Record<string, Handler> = {}) {
  const log: string[] = [];
  const stored = new Map<string, Set<number>>();
  let duplicates = 0;
  const created = new Set<string>();
  const routes: Record<string, Handler> = {
    'POST /shifts': (r) => {
      const id = (r.body as { client_id: string }).client_id;
      created.add(id);
      log.push(`create ${id}`);
      return json(201, { id: 1 });
    },
    'POST /telemetry/batch': (r) => {
      const b = r.body as { shift_client_id: string; points: { seq: number }[] };
      if (!created.has(b.shift_client_id)) return problem(404, 'shift_not_found');
      const set = stored.get(b.shift_client_id) ?? new Set<number>();
      stored.set(b.shift_client_id, set);
      for (const p of b.points) {
        if (set.has(p.seq)) duplicates++;
        set.add(p.seq);
      }
      log.push(`points ${b.shift_client_id} ${b.points.length}`);
      return json(200, {
        inserted: b.points.length,
        duplicates: 0,
        rejected: [],
        server_time: 1,
        upload_hint_s: 60,
      });
    },
  };
  for (let i = 0; i < n; i++) {
    routes[`POST /shifts/${sid(i)}/end`] = (r) => {
      const body = r.body as {
        phone_result?: { total_m: number };
        manifest?: { point_count: number };
      };
      // The barrier: every point of the manifest must be stored before `end` arrives.
      const have = stored.get(sid(i))?.size ?? 0;
      log.push(`end ${sid(i)} after ${have}/${body.manifest?.point_count ?? 0}`);
      const total = body.phone_result?.total_m ?? 0;
      return json(200, {
        id: 100 + i,
        total_m: total,
        active_m: total,
        deadhead_m: 0,
        personal_m: 0,
        calc_version: algorithmVersion,
        recon: { status: 'match', server_total_m: total, diff_m: 0, reasons: [] },
      });
    };
  }
  Object.assign(routes, over);
  const server = mockServer(routes);
  return {
    server,
    log,
    stored,
    created,
    get duplicates() {
      return duplicates;
    },
  };
}

/** Records `n` shifts of `points` fixes each with the network down, one day apart. */
async function backlog(
  n: number,
  points: number,
  goodFetch: () => (url: string, init: RequestInit) => Promise<Response>,
) {
  const clock = { t: BASE };
  let up = false;
  let counter = 0;
  const tracker = new FakeTracker(() => clock.t);
  const { services } = makeServices(
    (u, i) => (up ? goodFetch()(u, i) : Promise.reject(new TypeError('offline'))),
    { paired: true, tracker, now: () => clock.t, newId: () => sid(counter++) },
  );
  for (let k = 0; k < n; k++) {
    clock.t = BASE + k * DAY;
    await services.shift.start({ vehicleId: 3 });
    for (let j = 0; j < points; j++) {
      tracker.emit({
        recordedAt: clock.t + 1_000 + j * 10_000,
        latE7: 400_000_000 + j * 3_000,
        lonE7: 0,
        accuracyM: 5,
      });
    }
    clock.t += points * 10_000 + 5_000;
    await services.shift.end();
  }
  return {
    services,
    tracker,
    clock,
    goOnline: () => {
      up = true;
    },
  };
}

describe('backlog drain (C8, 15 section 6)', () => {
  it('24 offline shifts drain oldest first, each as create, points, end, with nothing lost or doubled', async () => {
    const rec = recordingServer(24);
    const { services, tracker, goOnline } = await backlog(24, 600, () => rec.server.fetch);
    expect((await services.shifts.list()).every((s) => s.sync_state === 'local')).toBe(true);
    expect((await services.outbox.counts()).pending).toBe(24 * 2);

    goOnline();
    const seen: string[] = [];
    services.sync.subscribe((p) => void seen.push(p.phase));
    expect(await services.sync.drain()).toEqual({ state: 'idle', retryInMs: null });

    // Order: shift 0 completely, then shift 1, and so on.
    const order = rec.log.map((e) => Number(e.split(' ')[1]!.slice(-12)));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (let i = 0; i < 24; i++) {
      const mine = rec.log.filter((e) => e.includes(sid(i)));
      expect(mine[0]).toBe(`create ${sid(i)}`);
      expect(mine.slice(1, -1)).toEqual([`points ${sid(i)} 500`, `points ${sid(i)} 100`]);
      expect(mine[mine.length - 1]).toBe(`end ${sid(i)} after 600/600`);
    }
    expect(rec.duplicates).toBe(0);
    expect([...rec.stored.values()].every((s) => s.size === 600)).toBe(true);
    expect(tracker.readPending(100_000)).toHaveLength(0);

    const rows = await services.shifts.list();
    expect(rows).toHaveLength(24);
    expect(rows.every((s) => s.sync_state === 'on_server' && s.calc_source === 'server')).toBe(
      true,
    );
    expect(rows.every((s) => s.recon_status === 'match')).toBe(true);
    expect(await services.outbox.counts()).toEqual({ pending: 0, parked: 0, oldestAt: null });
    expect(services.sync.progress).toMatchObject({
      phase: 'done',
      pointsSent: 24 * 600,
      pointsTotal: 24 * 600,
      shiftsDone: 24,
      shiftsTotal: 24,
    });
    expect(seen[0]).toBe('running');
  });

  it('cancel stops between requests; the next drain resumes with no loss and no duplicate', async () => {
    const rec = recordingServer(4);
    const ctx = await backlog(4, 1200, () => rec.server.fetch);
    ctx.goOnline();
    let telemetry = 0;
    const original = rec.server.routes['POST /telemetry/batch']!;
    rec.server.routes['POST /telemetry/batch'] = (r) => {
      if (++telemetry === 4) ctx.services.sync.cancel();
      return original(r);
    };
    expect((await ctx.services.sync.drain()).state).toBe('cancelled');
    expect(ctx.services.sync.progress.phase).toBe('cancelled');
    expect(rec.log.filter((e) => e.startsWith('points')).length).toBe(4);
    expect(ctx.tracker.readPending(100_000).length).toBeGreaterThan(0);

    expect((await ctx.services.sync.drain()).state).toBe('idle');
    expect(rec.duplicates).toBe(0);
    expect([...rec.stored.values()].map((s) => s.size)).toEqual([1200, 1200, 1200, 1200]);
    expect(ctx.tracker.readPending(100_000)).toHaveLength(0);
  });

  it('the end waits for a failed batch: nothing after it is sent until the server is back', async () => {
    const rec = recordingServer(3);
    const ctx = await backlog(3, 700, () => rec.server.fetch);
    ctx.goOnline();
    let fail = true;
    const original = rec.server.routes['POST /telemetry/batch']!;
    rec.server.routes['POST /telemetry/batch'] = (r) => {
      const b = r.body as { shift_client_id: string; points: unknown[] };
      if (fail && b.shift_client_id === sid(1) && b.points.length === 200) {
        return problem(503, 'unavailable', true);
      }
      return original(r);
    };
    const first = await ctx.services.sync.drain();
    expect(first.state).toBe('offline');
    expect(first.retryInMs).toBeGreaterThan(0);
    expect(rec.log.some((e) => e.startsWith(`end ${sid(1)}`))).toBe(false);
    expect(rec.log.some((e) => e.includes(sid(2)))).toBe(false);
    expect(rec.log.some((e) => e.startsWith(`end ${sid(0)}`))).toBe(true);

    fail = false;
    expect((await ctx.services.sync.drain()).state).toBe('idle');
    expect(rec.log.filter((e) => e.startsWith('end')).map((e) => e.slice(4, 40))).toEqual([
      sid(0),
      sid(1),
      sid(2),
    ]);
    expect(rec.duplicates).toBe(0);
  });

  it('a shift whose create is refused is parked and does not hold back the shifts after it', async () => {
    const rec = recordingServer(3);
    const created = rec.server.routes['POST /shifts']!;
    rec.server.routes['POST /shifts'] = (r) =>
      (r.body as { client_id: string }).client_id === sid(1)
        ? problem(409, 'shift_already_active')
        : created(r);
    const ctx = await backlog(3, 300, () => rec.server.fetch);
    ctx.goOnline();
    expect((await ctx.services.sync.drain()).state).toBe('idle');
    const rows = await ctx.services.shifts.list();
    expect(rows.map((s) => s.sync_state).reverse()).toEqual([
      'on_server',
      'needs_attention',
      'on_server',
    ]);
    expect(rec.stored.has(sid(1))).toBe(false);
    expect(rec.stored.get(sid(2))!.size).toBe(300);
    expect(ctx.tracker.readPending(10_000).every((p) => p.shiftClientId === sid(1))).toBe(true);
  });

  it('the running shift goes first: its overdue points are sent between backlog batches', async () => {
    const rec = recordingServer(2);
    const ctx = await backlog(2, 1200, () => rec.server.fetch);
    ctx.goOnline();
    // A shift that is running now (create already acknowledged).
    ctx.clock.t = BASE + 10 * DAY;
    const original = rec.server.routes['POST /telemetry/batch']!;
    let n = 0;
    rec.server.routes['POST /telemetry/batch'] = (r) => {
      if (++n === 2) {
        // Two minutes of live driving have piled up while the backlog was draining.
        for (let j = 0; j < 5; j++) {
          ctx.tracker.emit({
            recordedAt: ctx.clock.t - 120_000 + j * 10_000,
            latE7: 410_000_000 + j * 3_000,
            lonE7: 0,
          });
        }
      }
      return original(r);
    };
    const made = await ctx.services.shift.start({ vehicleId: 3 });
    expect(made.ok).toBe(true);
    const liveId = ctx.services.shift.current!.clientId;
    expect(liveId).toBe(sid(2));
    await ctx.services.sync.drain();
    const points = rec.log.filter((e) => e.startsWith('points'));
    const firstLive = points.findIndex((e) => e.includes(liveId));
    const lastBacklog = points
      .map((e, i) => (e.includes(liveId) ? -1 : i))
      .reduce((a, b) => Math.max(a, b));
    expect(firstLive).toBeGreaterThan(-1);
    expect(firstLive).toBeLessThan(lastBacklog);
  });
});
