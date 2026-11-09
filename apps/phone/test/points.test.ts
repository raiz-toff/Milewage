import { json, problem, type Handler, type Recorded } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

/** A shift's points as the sender sends them (08 section 4.2, 4.3), at `services.sender`. */

interface Batch {
  shift_client_id: string;
  points: { seq: number; recorded_at: number; lat_e7: number; speed_dmps: number | null }[];
}
const batch = (r: Recorded) => r.body as Batch;
const seqs = (r: Recorded) => batch(r).points.map((p) => p.seq);
const accepted = (r: Recorded, hint = 60) =>
  json(200, {
    inserted: batch(r).points.length,
    duplicates: 0,
    rejected: [],
    server_time: 1,
    upload_hint_s: hint,
  });

/** A server that stores by seq and answers like 08 section 5: counts inserted and duplicates. */
function telemetryServer(over: Record<string, Handler> = {}) {
  const stored = new Set<number>();
  const routes = server({
    'POST /telemetry/batch': (r) => {
      let inserted = 0;
      let duplicates = 0;
      for (const p of batch(r).points) {
        if (stored.has(p.seq)) duplicates++;
        else {
          stored.add(p.seq);
          inserted++;
        }
      }
      return json(200, { inserted, duplicates, rejected: [], server_time: 1, upload_hint_s: 60 });
    },
    ...over,
  });
  return { routes, stored };
}

/** A running shift the server has, with `n` fixes recorded. */
async function running(n: number, over: Record<string, Handler> = {}) {
  const ts = telemetryServer(over);
  const ctx = setup(ts.routes);
  await ctx.services.shift.start({ vehicleId: 3 });
  for (let i = 0; i < n; i++) ctx.tracker.emit({ recordedAt: 1_000 + i * 10_000, latE7: 1000 + i });
  const posts = () => ts.routes.calls.filter((c) => c.path === '/telemetry/batch');
  return { ...ctx, ...ts, posts, sender: ctx.services.sender };
}

/** The same, ended: its points are a backlog now. */
async function ended(n: number, over: Record<string, Handler> = {}) {
  const p = await running(n, over);
  p.clock.t = 1_000 + n * 10_000;
  await p.services.shift.end();
  return p;
}

/** Runs the send loop on fake timers; `at(ms)` says how many batches were posted by then. */
async function loop(
  p: Awaited<ReturnType<typeof running>>,
  fn: (at: (ms: number) => Promise<number>) => Promise<void>,
) {
  jest.useFakeTimers();
  let now = 0;
  try {
    p.sender.start();
    await fn(async (ms) => {
      await jest.advanceTimersByTimeAsync(ms - now);
      now = ms;
      return p.posts().length;
    });
  } finally {
    p.sender.stop();
    jest.useRealTimers();
  }
}

describe('points: batches', () => {
  it('the running shift goes in gzip batches of 100, in seq order, and is marked sent', async () => {
    const p = await running(250);
    await p.sender.sendNow();
    expect(p.posts().map((c) => batch(c).points.length)).toEqual([100, 100, 50]);
    expect(p.posts()[0]!.headers['Content-Encoding']).toBe('gzip');
    expect(batch(p.posts()[0]!).shift_client_id).toBe(ID);
    expect(seqs(p.posts()[0]!)[0]).toBe(1);
    expect(batch(p.posts()[0]!).points[0]).toMatchObject({ lat_e7: 1000, speed_dmps: null });
    expect(p.tracker.readPending(1000)).toHaveLength(0);
    expect(p.stored.size).toBe(250);
  });

  it('an ended shift goes in 500s; no request ever carries more', async () => {
    const p = await ended(1200);
    expect(await p.sender.sendNow()).toBe(true);
    expect(p.posts().map((c) => batch(c).points.length)).toEqual([500, 500, 200]);
  });

  it('a lost reply is safe: the retry sends the same seqs and nothing is doubled', async () => {
    let first = true;
    const p = await running(5, {
      'POST /telemetry/batch': (r) => {
        if (first) {
          first = false;
          for (const q of batch(r).points) p.stored.add(q.seq); // stored, but the reply was lost
          return problem(503, 'unavailable', true);
        }
        const dup = batch(r).points.filter((q) => p.stored.has(q.seq)).length;
        return json(200, {
          inserted: 0,
          duplicates: dup,
          rejected: [],
          server_time: 1,
          upload_hint_s: 60,
        });
      },
    });
    await p.sender.sendNow();
    expect(p.tracker.readPending(10)).toHaveLength(5);
    expect((await p.sender.status()).message).toBe('Offline. Saved on your phone.');
    await p.sender.sendNow();
    expect(p.tracker.readPending(10)).toHaveLength(0);
    const [a, b] = p.posts();
    expect(seqs(a!)).toEqual(seqs(b!));
    expect(p.stored.size).toBe(5);
    await p.sender.sendNow();
    expect(p.posts()).toHaveLength(2); // all acknowledged: nothing more
  });

  it('points the server rejects are set aside and never sent again; the rest are sent', async () => {
    const p = await running(5, {
      'POST /telemetry/batch': () =>
        json(200, {
          inserted: 4,
          duplicates: 0,
          rejected: [{ seq: 3, code: 'invalid_coordinate' }],
          server_time: 1,
          upload_hint_s: 60,
        }),
    });
    await p.sender.sendNow();
    expect(p.tracker.quarantined).toEqual([3]);
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('the server hint sets when the loop sends again, clamped to 10-300 s', async () => {
    for (const [hint, want] of [
      [15, 15_000],
      [3, 10_000],
      [999, 300_000],
    ] as const) {
      const p = await running(1, { 'POST /telemetry/batch': (r) => accepted(r, hint) });
      await loop(p, async (at) => {
        expect(await at(1)).toBe(1);
        p.clock.t = 2_000_000;
        p.tracker.emit({ recordedAt: 1_999_000 });
        expect(await at(want - 2)).toBe(1);
        expect(await at(want + 2)).toBe(2);
      });
    }
  });

  it('counts each attempt for the diagnostics window', async () => {
    const p = await running(3);
    await p.sender.sendNow();
    const s = p.sender.takeUploadStats();
    expect(s).toMatchObject({ attempts: 1, ok: 1, fail_net: 0 });
    expect(s.bytes_gz).toBeGreaterThan(0);
    expect(p.sender.takeUploadStats().attempts).toBe(0);
  });
});

describe('points: failures keep them', () => {
  it('offline: the backlog stays pending, the loop waits 2, 4, then 8 s, and it all goes when back', async () => {
    let up = false;
    const p = await ended(7, {
      'POST /telemetry/batch': (r) => (up ? accepted(r) : Promise.reject(new Error('offline'))),
    });
    await loop(p, async (at) => {
      expect(await at(1)).toBe(1);
      expect(await at(1_998)).toBe(1);
      expect(await at(2_002)).toBe(2);
      expect(await at(5_998)).toBe(2);
      expect(await at(6_004)).toBe(3);
      expect(p.tracker.readPending(100)).toHaveLength(7);
      expect(p.sender.takeUploadStats().fail_net).toBe(3);
      up = true;
      expect(await at(14_006)).toBe(4);
    });
    expect(p.tracker.readPending(100)).toHaveLength(0);
    expect((await p.sender.status()).unsyncedShifts).toBe(0);
  });

  it('429 and 507 wait for the Retry-After; a 5xx follows the schedule', async () => {
    const p = await ended(1, {
      'POST /telemetry/batch': () => problem(429, 'rate_limited', true, { 'Retry-After': '9' }),
    });
    await loop(p, async (at) => {
      expect(await at(1)).toBe(1);
      expect(await at(8_999)).toBe(1);
      expect(await at(9_002)).toBe(2);
    });
    expect(p.sender.takeUploadStats().fail_429).toBe(2);
    const q = await ended(1, {
      'POST /telemetry/batch': () => problem(507, 'insufficient_storage', true),
    });
    expect(await q.sender.sendNow()).toBe(false);
    expect(q.sender.takeUploadStats().fail_507).toBe(1);
  });

  it('401 device_revoked halts and keeps the points; pairing again sends them', async () => {
    let revoked = true;
    const p = await running(3, {
      'POST /telemetry/batch': (r) => (revoked ? problem(401, 'device_revoked') : accepted(r)),
    });
    await p.sender.sendNow();
    expect((await p.sender.status()).halt).toBe('repair');
    await p.sender.sendNow();
    expect(p.posts()).toHaveLength(1); // the second round sent no points
    expect(p.tracker.readPending(10)).toHaveLength(3);
    revoked = false;
    await p.services.pairing.device.resume(); // what pairing again does
    await p.sender.sendNow();
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('another 401 or a 403 is a sign-in problem, not a revoke', async () => {
    const p = await running(1, { 'POST /telemetry/batch': () => problem(401, 'invalid_token') });
    await p.sender.sendNow();
    expect((await p.sender.status()).halt).toBe('auth_problem');
    const q = await running(1, { 'POST /telemetry/batch': () => problem(403, 'scope_forbidden') });
    await q.sender.sendNow();
    expect((await q.sender.status()).halt).toBe('auth_problem');
  });

  it('404 shift_not_found: tried 3 times, then set aside without being dropped', async () => {
    const ts = telemetryServer({ 'POST /telemetry/batch': () => problem(404, 'shift_not_found') });
    const { services, tracker } = setup(ts.routes);
    tracker.start(ID); // points of a shift this phone never queued a create for
    tracker.emit({ recordedAt: 1_000 });
    tracker.emit({ recordedAt: 11_000 });
    const posts = () => ts.routes.calls.filter((c) => c.path === '/telemetry/batch');
    for (let i = 0; i < 3; i++) await services.sender.sendNow();
    expect(posts()).toHaveLength(3);
    expect(tracker.readPending(10)).toHaveLength(2); // set aside, not dropped
    await services.sender.sendNow();
    expect(posts()).toHaveLength(3);
  });

  it('409 shift_finalized sets the points aside', async () => {
    const p = await running(3, {
      'POST /telemetry/batch': () => problem(409, 'shift_finalized'),
    });
    await p.sender.sendNow();
    expect(p.tracker.quarantined).toEqual([1, 2, 3]);
  });

  it('413 halves the batch and tries again', async () => {
    const p = await running(8, {
      'POST /telemetry/batch': (r) =>
        batch(r).points.length > 2 ? problem(413, 'payload_too_large') : accepted(r),
    });
    await p.sender.sendNow();
    expect(p.posts().map((c) => batch(c).points.length)).toEqual([8, 4, 2, 2, 2, 2]);
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('422 on a batch finds the bad point and does not hold back the rest', async () => {
    const p = await running(6, {
      'POST /telemetry/batch': (r) =>
        seqs(r).includes(4) ? problem(422, 'validation_failed') : accepted(r),
    });
    await p.sender.sendNow();
    expect(p.tracker.quarantined).toEqual([4]);
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('tracking off on the server, or not paired: no points are sent', async () => {
    const routes = server();
    const off = setup(routes, { paired: { modules: { tracking: false } } });
    off.tracker.start(ID);
    off.tracker.emit({ recordedAt: 1000 });
    await off.services.sender.sendNow();
    const unpaired = setup(routes, { paired: false });
    unpaired.tracker.start(ID);
    unpaired.tracker.emit({ recordedAt: 1000 });
    await unpaired.services.sender.sendNow();
    expect(routes.calls.filter((c) => c.path === '/telemetry/batch')).toHaveLength(0);
  });

  it('a running shift whose create the server has not acknowledged sends no points', async () => {
    const p = await running(0, { 'POST /shifts': () => problem(503, 'read_only_mode', true) });
    p.tracker.emit({ recordedAt: 2000 });
    await p.sender.sendNow();
    expect(p.posts()).toHaveLength(0);
    expect((await p.sender.status()).message).toBe('Offline. Saved on your phone.');
  });
});
