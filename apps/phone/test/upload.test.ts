import { Backoff, BACKOFF_S, MAX_BATCH } from '../src/upload/worker';
import { json, problem, type Handler, type Recorded } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

interface Batch {
  shift_client_id: string;
  points: { seq: number; recorded_at: number; lat_e7: number; speed_dmps: number | null }[];
}
const batch = (r: Recorded) => r.body as Batch;
const seqs = (r: Recorded) => batch(r).points.map((p) => p.seq);

/** A server that stores by (seq) and answers like 08 section 5: counts inserted and duplicates. */
function telemetryServer(over: Partial<Record<string, Handler>> = {}) {
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
    ...(over as Record<string, Handler>),
  });
  return { routes, stored };
}

/** A paired phone with a tracker recording `n` fixes for the shift ID. */
function phone(n: number, over: Partial<Record<string, Handler>> = {}) {
  const ts = telemetryServer(over);
  const ctx = setup(ts.routes);
  ctx.tracker.start(ID);
  for (let i = 0; i < n; i++) ctx.tracker.emit({ recordedAt: 1_000 + i * 10_000, latE7: 1000 + i });
  const posts = () => ts.routes.calls.filter((c) => c.path === '/telemetry/batch');
  return { ...ctx, ...ts, posts, uploader: ctx.services.uploader };
}

describe('Backoff', () => {
  it('2, 4, 8, 16, 32, then 60 s; jitter within 20 percent; a success resets', () => {
    const b = new Backoff(() => 0.5);
    expect([1, 2, 3, 4, 5, 6, 7].map(() => b.next())).toEqual([
      ...BACKOFF_S.map((s) => s * 1000),
      60_000,
    ]);
    b.reset();
    expect(b.next()).toBe(2000);
    const lo = new Backoff(() => 0);
    const hi = new Backoff(() => 1);
    expect([lo.next(), hi.next()]).toEqual([1600, 2400]);
  });

  it('Retry-After overrides the schedule', () => {
    expect(new Backoff().next(7)).toBe(7000);
  });
});

describe('UploadWorker batching', () => {
  it('sends gzip batches of 100 in seq order and marks them uploaded', async () => {
    const p = phone(250);
    const r = await p.uploader.drain();
    expect(r).toMatchObject({ state: 'idle', uploaded: 250, rejected: 0 });
    expect(p.posts().map((c) => batch(c).points.length)).toEqual([100, 100, 50]);
    expect(p.posts()[0]!.headers['Content-Encoding']).toBe('gzip');
    expect(batch(p.posts()[0]!).shift_client_id).toBe(ID);
    expect(seqs(p.posts()[0]!)[0]).toBe(1);
    expect(batch(p.posts()[0]!).points[0]).toMatchObject({ lat_e7: 1000, speed_dmps: null });
    expect(p.tracker.readPending(1000)).toHaveLength(0);
    expect(p.stored.size).toBe(250);
  });

  it('never sends more than 500 points; a big backlog goes in 500s', async () => {
    const p = phone(1200);
    await p.uploader.drain();
    const sizes = p.posts().map((c) => batch(c).points.length);
    expect(sizes).toEqual([500, 500, 200]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_BATCH);
  });

  it('is idempotent: a retry after a lost reply resends the same seqs and nothing is doubled', async () => {
    let first = true;
    const p = phone(5, {
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
    expect((await p.uploader.drain()).state).toBe('backoff');
    expect(p.tracker.readPending(10)).toHaveLength(5);
    expect((await p.uploader.drain()).uploaded).toBe(5);
    const [a, b] = p.posts();
    expect(seqs(a!)).toEqual(seqs(b!));
    expect(p.stored.size).toBe(5);
    // Fully acknowledged: a further drain sends nothing.
    await p.uploader.drain();
    expect(p.posts()).toHaveLength(2);
  });

  it('rejected points are quarantined and never retried; the rest are uploaded', async () => {
    const p = phone(5, {
      'POST /telemetry/batch': () =>
        json(200, {
          inserted: 4,
          duplicates: 0,
          rejected: [{ seq: 3, code: 'invalid_coordinate' }],
          server_time: 1,
          upload_hint_s: 60,
        }),
    });
    const r = await p.uploader.drain();
    expect(r).toMatchObject({ uploaded: 4, rejected: 1 });
    expect(p.tracker.quarantined).toEqual([3]);
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('the server hint sets the interval, clamped to 10-300 s', async () => {
    for (const [hint, want] of [
      [15, 15_000],
      [3, 10_000],
      [999, 300_000],
    ] as const) {
      const p = phone(1, {
        'POST /telemetry/batch': () =>
          json(200, {
            inserted: 1,
            duplicates: 0,
            rejected: [],
            server_time: 1,
            upload_hint_s: hint,
          }),
      });
      await p.uploader.drain();
      expect(p.uploader.intervalMs).toBe(want);
    }
  });

  it('records upload counters for diagnostics', async () => {
    const p = phone(3);
    await p.uploader.drain();
    const s = p.uploader.takeStats();
    expect(s).toMatchObject({ attempts: 1, ok: 1, fail_net: 0 });
    expect(s.bytes_gz).toBeGreaterThan(0);
    expect(p.uploader.takeStats().attempts).toBe(0);
  });
});

describe('UploadWorker failures and the offline queue', () => {
  it('offline: points stay PENDING, backoff grows, everything uploads when back', async () => {
    let up = false;
    const p = phone(7, {
      'POST /telemetry/batch': (r) =>
        up
          ? json(200, {
              inserted: batch(r).points.length,
              duplicates: 0,
              rejected: [],
              server_time: 1,
              upload_hint_s: 60,
            })
          : Promise.reject(new Error('offline')),
    });
    const waits: (number | null)[] = [];
    for (let i = 0; i < 3; i++) waits.push((await p.uploader.drain()).retryInMs);
    expect(p.tracker.readPending(100)).toHaveLength(7);
    const bases = [2000, 4000, 8000];
    waits.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(bases[i]! * 0.8);
      expect(w).toBeLessThanOrEqual(bases[i]! * 1.2);
    });
    expect(p.uploader.takeStats().fail_net).toBe(3);
    up = true;
    expect(await p.uploader.drain()).toMatchObject({ state: 'idle', uploaded: 7 });
  });

  it('429 and 507 honour Retry-After; 5xx uses the schedule', async () => {
    const p = phone(1, {
      'POST /telemetry/batch': () => problem(429, 'rate_limited', true, { 'Retry-After': '9' }),
    });
    expect((await p.uploader.drain()).retryInMs).toBe(9000);
    expect(p.uploader.takeStats().fail_429).toBe(1);
    const q = phone(1, {
      'POST /telemetry/batch': () => problem(507, 'insufficient_storage', true),
    });
    expect((await q.uploader.drain()).state).toBe('backoff');
    expect(q.uploader.takeStats().fail_507).toBe(1);
  });

  it('401 device_revoked halts, keeps the buffer, and resumes after re-pairing', async () => {
    let revoked = true;
    const p = phone(3, {
      'POST /telemetry/batch': () =>
        revoked
          ? problem(401, 'device_revoked')
          : json(200, {
              inserted: 3,
              duplicates: 0,
              rejected: [],
              server_time: 1,
              upload_hint_s: 60,
            }),
    });
    expect((await p.uploader.drain()).state).toBe('halted');
    expect(await p.services.device.halted()).toBe('repair');
    expect((await p.uploader.drain()).state).toBe('halted');
    expect(p.posts()).toHaveLength(1); // the second drain made no request
    expect(p.tracker.readPending(10)).toHaveLength(3);
    revoked = false;
    await p.services.device.resume(); // what pairing again does
    expect(await p.uploader.drain()).toMatchObject({ state: 'idle', uploaded: 3 });
  });

  it('another 401 or a 403 is a sign-in problem, not a revoke', async () => {
    const p = phone(1, { 'POST /telemetry/batch': () => problem(401, 'invalid_token') });
    expect((await p.uploader.drain()).state).toBe('halted');
    expect(await p.services.device.halted()).toBe('auth_problem');
    const q = phone(1, { 'POST /telemetry/batch': () => problem(403, 'scope_forbidden') });
    expect((await q.uploader.drain()).state).toBe('halted');
    expect(await q.services.device.halted()).toBe('auth_problem');
  });

  it('404 shift_not_found flushes the outbox and retries, then parks after 3 attempts without dropping', async () => {
    const p = phone(2, { 'POST /telemetry/batch': () => problem(404, 'shift_not_found') });
    const flush = jest.spyOn(p.services.shift, 'sync');
    expect((await p.uploader.drain()).state).toBe('backoff');
    expect((await p.uploader.drain()).state).toBe('backoff');
    expect((await p.uploader.drain()).state).toBe('parked');
    expect(flush).toHaveBeenCalledTimes(3);
    expect(p.posts()).toHaveLength(3);
    expect(p.tracker.readPending(10)).toHaveLength(2); // parked, not dropped
    await p.uploader.drain();
    expect(p.posts()).toHaveLength(3); // parked shifts are skipped
  });

  it('409 shift_finalized quarantines the points', async () => {
    const p = phone(3, { 'POST /telemetry/batch': () => problem(409, 'shift_finalized') });
    const r = await p.uploader.drain();
    expect(r.rejected).toBe(3);
    expect(p.tracker.quarantined).toEqual([1, 2, 3]);
  });

  it('413 halves the batch and retries', async () => {
    const p = phone(8, {
      'POST /telemetry/batch': (r) =>
        batch(r).points.length > 2
          ? problem(413, 'payload_too_large')
          : json(200, {
              inserted: batch(r).points.length,
              duplicates: 0,
              rejected: [],
              server_time: 1,
              upload_hint_s: 60,
            }),
    });
    expect((await p.uploader.drain()).uploaded).toBe(8);
    expect(p.posts().map((c) => batch(c).points.length)).toEqual([8, 4, 2, 2, 2, 2]);
  });

  it('422 on a batch isolates the bad point and does not block the queue', async () => {
    const p = phone(6, {
      'POST /telemetry/batch': (r) =>
        seqs(r).includes(4)
          ? problem(422, 'validation_failed')
          : json(200, {
              inserted: batch(r).points.length,
              duplicates: 0,
              rejected: [],
              server_time: 1,
              upload_hint_s: 60,
            }),
    });
    const r = await p.uploader.drain();
    expect(r).toMatchObject({ uploaded: 5, rejected: 1 });
    expect(p.tracker.quarantined).toEqual([4]);
  });

  it('tracking off on the server, or not paired: nothing is sent', async () => {
    const off = phone(2);
    const noTrack = setup(off.routes, { paired: { modules: { tracking: false } } });
    noTrack.tracker.start(ID);
    noTrack.tracker.emit({ recordedAt: 1000 });
    expect((await noTrack.services.uploader.drain()).state).toBe('tracking_off');
    const unpaired = setup(off.routes, { paired: false });
    expect((await unpaired.services.uploader.drain()).state).toBe('not_paired');
    expect(off.posts()).toHaveLength(0);
  });
});

describe('create before upload, and the end barrier', () => {
  it('a shift whose create is not acknowledged sends no telemetry', async () => {
    const p = phone(0, { 'POST /shifts': () => problem(503, 'read_only_mode', true) });
    await p.services.shift.start({ vehicleId: 3 });
    p.tracker.emit({ recordedAt: 2000 });
    const r = await p.uploader.drain();
    expect(r.state).toBe('waiting_create');
    expect(p.posts()).toHaveLength(0);
  });

  it('end waits for the points: telemetry first, then shift.end', async () => {
    let up = false;
    const order: string[] = [];
    const p = phone(0, {
      'POST /telemetry/batch': (r) => {
        order.push('telemetry');
        return up
          ? json(200, {
              inserted: batch(r).points.length,
              duplicates: 0,
              rejected: [],
              server_time: 1,
              upload_hint_s: 60,
            })
          : problem(503, 'x', true);
      },
      [`POST /shifts/${ID}/end`]: () => {
        order.push('end');
        return json(200, {});
      },
    });
    await p.services.shift.start({ vehicleId: 3 });
    p.tracker.emit({ recordedAt: 2000 });
    p.tracker.emit({ recordedAt: 12_000 });
    expect(await p.services.shift.end()).toEqual({ ok: true, sent: false });
    expect(order).not.toContain('end');
    expect(p.services.shift.current?.endedAt).not.toBeNull();
    up = true;
    expect(await p.services.shift.sync()).toBe(true);
    expect(order).toEqual(['telemetry', 'telemetry', 'end']);
    expect(p.tracker.readPending(10)).toHaveLength(0);
  });

  it('the timer loop uploads on start and stops on stop', async () => {
    jest.useFakeTimers();
    try {
      const p = phone(3);
      p.uploader.start();
      await jest.advanceTimersByTimeAsync(1);
      expect(p.posts()).toHaveLength(1);
      p.tracker.emit({ recordedAt: 99_000 });
      await jest.advanceTimersByTimeAsync(60_000);
      expect(p.posts()).toHaveLength(2);
      p.uploader.stop();
      p.tracker.emit({ recordedAt: 109_000 });
      await jest.advanceTimersByTimeAsync(120_000);
      expect(p.posts()).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
