import { openNodeAppDb } from './support/nodeSql';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { algorithmVersion, processShift } from '@milewage/track-engine';
import { toFix } from '../src/shift/feed';
import { ApiError } from '../src/api/client';
import { FakeTracker } from '../src/tracker/fake';
import { json, makeServices, problem } from './support/mock';
import { drive, ID, setup, SHIFT, server } from './support/shiftKit';

describe('ShiftController', () => {
  it('records first, then creates idempotently with the segmenter and start odometer', async () => {
    const { services, tracker, routes } = setup();
    const r = await services.shift.start({ vehicleId: 3, odometerStartM: 12_345 });
    expect(r.ok).toBe(true);
    expect(tracker.isTracking()).toBe(true);
    const post = routes.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      client_id: ID,
      vehicle_id: 3,
      started_at: 1_000,
      segmenter: 'stops',
    });
    expect(post.headers.Authorization).toMatch(/^Bearer mwd_/);
    const put = routes.calls.find((c) => c.path.endsWith('/odometer/shift_start'))!;
    expect(put.body).toEqual({ reading_m: 12_345, recorded_at: 1_000 });
    expect(services.shift.current?.created).toBe(true);
  });

  it('a replayed create (200) is fine; the same client_id is sent again after an outage', async () => {
    let up = false;
    const routes = server({
      'POST /shifts': () => (up ? json(200, SHIFT) : problem(503, 'read_only_mode', true)),
    });
    const { services, tracker } = setup(routes);
    const r = await services.shift.start({ vehicleId: 3 });
    expect(r.ok && r.shift.created).toBe(false);
    expect(tracker.isTracking()).toBe(true); // recorded even though the server never answered
    expect(await services.shift.sync()).toBe(false); // still down
    up = true;
    await services.shift.sync();
    expect(services.shift.current?.created).toBe(true);
    const posts = routes.calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => (p.body as { client_id: string }).client_id)).toEqual([ID, ID, ID]);
  });

  it('network failure keeps the shift and the tracker running', async () => {
    const { services, tracker } = setup(undefined, {
      paired: true,
      fetch: async () => {
        throw new Error('offline');
      },
    });
    const r = await services.shift.start({ vehicleId: 3 });
    expect(r.ok).toBe(true);
    expect(tracker.isTracking()).toBe(true);
  });

  it('409 shift_already_active stops the tracker and offers the server shift', async () => {
    const routes = server({
      'POST /shifts': () =>
        json(409, {
          code: 'shift_already_active',
          retryable: false,
          active_shift: { ...SHIFT, client_id: 'other' },
        }),
    });
    const { services, tracker } = setup(routes);
    const r = await services.shift.start({ vehicleId: 3 });
    expect(r).toMatchObject({
      ok: false,
      reason: 'server_has_active',
      active: { client_id: 'other' },
    });
    expect(tracker.isTracking()).toBe(false);
    expect(services.shift.current).toBeNull();
    if (r.ok === false && r.reason === 'server_has_active') {
      expect((await services.shift.adopt(r.active)).ok).toBe(true);
      expect(tracker.isTracking()).toBe(true);
    }
  });

  it('a refused tracker start makes no network call', async () => {
    const { services, routes } = setup();
    jest.spyOn(FakeTracker.prototype, 'start').mockReturnValueOnce(false);
    const r = await services.shift.start({ vehicleId: 3 });
    expect(r).toEqual({ ok: false, reason: 'tracker_refused' });
    expect(routes.calls).toHaveLength(0);
  });

  it('not paired, and one shift at a time', async () => {
    const unpaired = setup(undefined, { paired: false });
    expect(await unpaired.services.shift.start({ vehicleId: 3 })).toEqual({
      ok: false,
      reason: 'not_paired',
    });
    const { services } = setup();
    await services.shift.start({ vehicleId: 3 });
    expect(await services.shift.start({ vehicleId: 3 })).toEqual({
      ok: false,
      reason: 'active_local',
    });
  });

  it('tracking module off: no tracker; stops off: whole_shift', async () => {
    const off = setup(undefined, { paired: { modules: { tracking: false } } });
    await off.services.shift.start({ vehicleId: 3 });
    expect(off.tracker.isTracking()).toBe(false);
    const whole = setup(undefined, { paired: { stops_enabled: false } });
    await whole.services.shift.start({ vehicleId: 3 });
    expect(whole.routes.calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      segmenter: 'whole_shift',
    });
  });

  it('live distance comes from the engine accumulator and survives markUploaded', async () => {
    const { services, tracker } = setup();
    await services.shift.start({ vehicleId: 3 });
    drive(tracker);
    const total = services.shift.pump();
    expect(total).toBeGreaterThan(430);
    expect(total).toBeLessThan(460);
    // The worker reads through the feed, uploads, marks: the number must not change or reset.
    const pts = services.feed.readPending(500);
    tracker.markUploaded(pts.map((p) => p.seq));
    expect(services.shift.pump()).toBe(total);
    // More driving adds to it.
    tracker.emit({ recordedAt: 61_000, latE7: 400_050_000, lonE7: 0 });
    expect(services.shift.pump()).toBeGreaterThan(total);
  });

  it('a start odometer edit is sent; end sends ended_at once and clears the shift', async () => {
    const { services, tracker, routes, clock, plain } = setup();
    await services.shift.start({ vehicleId: 3 });
    await services.shift.setOdometerStart(50_000);
    expect(routes.calls.filter((c) => c.path.endsWith('shift_start')).pop()!.body).toMatchObject({
      reading_m: 50_000,
    });
    clock.t = 99_000;
    const r = await services.shift.end({ odometerEndM: 60_000 });
    expect(r).toEqual({ ok: true, sent: true });
    expect(tracker.isTracking()).toBe(false);
    expect(routes.calls.find((c) => c.path.endsWith('/end'))!.body).toEqual({ ended_at: 99_000 });
    expect(routes.calls.find((c) => c.path.endsWith('shift_end'))!.body).toMatchObject({
      reading_m: 60_000,
    });
    expect(services.shift.current).toBeNull();
    expect(plain.data.has('shift.active')).toBe(false);
  });

  it('an end that cannot be sent is queued with its ended_at, then sent unchanged after a restart', async () => {
    let up = false;
    const routes = server({
      [`POST /shifts/${ID}/end`]: () => (up ? json(200, {}) : problem(503, 'x', true)),
    });
    const db = openNodeAppDb();
    const { services, clock } = setup(routes, { paired: true, openAppDb: async () => db });
    await services.shift.start({ vehicleId: 3 });
    clock.t = 7_000;
    expect(await services.shift.end()).toEqual({ ok: true, sent: false });
    expect(services.shift.current).toBeNull();
    expect((await services.outbox.pending()).map((i) => [i.kind, i.body])).toEqual([
      ['shift.end', { ended_at: 7_000 }],
    ]);
    expect(await services.shifts.get(ID)).toMatchObject({ status: 'ended', ended_at: 7_000 });

    // New process: same app.db, new object graph.
    clock.t = 500_000;
    up = true;
    const again = makeServices(routes.fetch, {
      paired: true,
      now: () => clock.t,
      openAppDb: async () => db,
    });
    await again.services.shift.load();
    expect(await again.services.shift.sync()).toBe(true);
    const ends = routes.calls.filter((c) => c.path.endsWith('/end'));
    expect(ends.map((c) => c.body)).toEqual([{ ended_at: 7_000 }, { ended_at: 7_000 }]);
  });

  it('409 on end (finalized on the web) is terminal', async () => {
    const routes = server({ [`POST /shifts/${ID}/end`]: () => problem(409, 'shift_finalized') });
    const { services } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    expect(await services.shift.end()).toEqual({ ok: true, sent: true });
    expect(services.shift.current).toBeNull();
  });

  it('live distance after a restart counts uploaded rows too and equals the uninterrupted figure', async () => {
    const { services, tracker, plain, clock } = setup();
    await services.shift.start({ vehicleId: 3 });
    drive(tracker); // five fixes, four accepted steps
    const uninterrupted = services.shift.pump();
    expect(uninterrupted).toBeGreaterThan(400);
    // Upload acknowledged the first three; two stay pending.
    const all = tracker.readPending(10);
    tracker.markUploaded(all.slice(0, 3).map((p) => p.seq));
    expect(tracker.readPending(10)).toHaveLength(2);

    // New process: the native buffer survives, the controller is new.
    const again = makeServices(server().fetch, { paired: true, tracker, now: () => clock.t });
    again.plain.data.set('shift.active', plain.data.get('shift.active')!);
    await again.services.shift.load();
    expect(again.services.shift.pump()).toBe(uninterrupted);
    // Points keep arriving after the restart and are counted once.
    tracker.emit({ recordedAt: 60_000, latE7: 400_050_000, lonE7: 0 });
    const more = again.services.shift.pump();
    expect(more).toBeGreaterThan(uninterrupted);
    expect(again.services.shift.pump()).toBe(more);
  });

  it('seeds a long shift from more than one page of stored rows', async () => {
    const { services, tracker, plain, clock } = setup();
    await services.shift.start({ vehicleId: 3 });
    for (let i = 0; i < 10_050; i++) {
      tracker.emit({ recordedAt: 1_000 + i * 10_000, latE7: 400_000_000 + i * 1_000, lonE7: 0 });
    }
    services.shift.pump(); // reads the first 10,000 pending rows
    tracker.markUploaded(tracker.readPending(10_000).map((p) => p.seq));
    const first = services.shift.pump(); // the remaining 50: now the exact total
    expect(first).toBeGreaterThan(100_000);
    const again = makeServices(server().fetch, { paired: true, tracker, now: () => clock.t });
    again.plain.data.set('shift.active', plain.data.get('shift.active')!);
    await again.services.shift.load();
    expect(again.services.shift.pump()).toBe(first);
  });

  describe('409 on a retried create', () => {
    const conflictRoutes = () => {
      let offline = true;
      const routes = server({
        'POST /shifts': () =>
          offline
            ? problem(503, 'x', true)
            : json(409, {
                code: 'shift_already_active',
                retryable: false,
                active_shift: { ...SHIFT, client_id: 'other', vehicle_id: 4 },
              }),
      });
      return { routes, online: () => (offline = false) };
    };

    it('keeps the local shift and its points, persists the conflict, and does not drop silently', async () => {
      const { routes, online } = conflictRoutes();
      const { services, tracker, plain } = setup(routes);
      expect((await services.shift.start({ vehicleId: 3 })).ok).toBe(true);
      drive(tracker);
      online();
      expect(await services.shift.sync()).toBe(false);
      expect(services.shift.current?.clientId).toBe(ID);
      expect(services.shift.conflict).toMatchObject({ client_id: 'other' });
      expect(tracker.isTracking()).toBe(true);
      expect(tracker.readPending(10)).toHaveLength(5);
      // survives a restart
      const again = makeServices(routes.fetch, { paired: true });
      again.plain.data.set('shift.active', plain.data.get('shift.active')!);
      await again.services.shift.load();
      expect(again.services.shift.conflict).toMatchObject({ client_id: 'other' });
    });

    it('"keep" dismisses the prompt for this shift; later syncs do not raise it again', async () => {
      const { routes, online } = conflictRoutes();
      const { services } = setup(routes);
      await services.shift.start({ vehicleId: 3 });
      online();
      await services.shift.sync();
      await services.shift.keepLocalShift();
      expect(services.shift.conflict).toBeNull();
      await services.shift.sync();
      expect(services.shift.conflict).toBeNull();
      expect(services.shift.current?.clientId).toBe(ID);
    });

    it('"use the server shift" drops the local one and continues the server shift', async () => {
      const { routes, online } = conflictRoutes();
      const { services, tracker } = setup(routes);
      await services.shift.start({ vehicleId: 3 });
      online();
      await services.shift.sync();
      const r = await services.shift.useServerShift();
      expect(r).toMatchObject({
        ok: true,
        shift: { clientId: 'other', vehicleId: 4, created: true },
      });
      expect(services.shift.conflict).toBeNull();
      expect(tracker.isTracking()).toBe(true);
    });
  });

  it('remembers the vehicle of the previous shift', async () => {
    const { services } = setup();
    expect(await services.shift.lastVehicleId()).toBeNull();
    await services.shift.start({ vehicleId: 3 });
    expect(await services.shift.lastVehicleId()).toBe(3);
  });

  describe('shift.end extras (manifest and phone_result)', () => {
    const endBody = (routes: ReturnType<typeof server>) =>
      routes.calls.filter((c) => c.path.endsWith('/end')).map((c) => c.body as Record<string, any>);

    it('sends the manifest and the engine result for the stored points, uploaded or not', async () => {
      const routes = server();
      const { services, tracker, clock } = setup(routes);
      await services.shift.start({ vehicleId: 3 });
      drive(tracker);
      clock.t = 100_000;
      await services.shift.end();
      const [body] = endBody(routes);
      const rows = tracker.readByShift(ID, 0, 100);
      const expected = processShift({
        shiftClientId: ID,
        startedAt: 1_000,
        endedAt: 100_000,
        fixes: rows.map(toFix),
        segmenter: 'stops',
      });
      expect(body).toEqual({
        ended_at: 100_000,
        manifest: { first_seq: rows[0]!.seq, last_seq: rows[4]!.seq, point_count: 5 },
        phone_result: {
          calc_version: algorithmVersion,
          segmenter: 'stops',
          input_digest: expected.inputDigest,
          total_m: expected.totals.totalM,
          active_m: expected.totals.activeM,
          deadhead_m: expected.totals.deadheadM,
          personal_m: expected.totals.personalM,
          trips_count: expected.trips.length,
        },
      });
      expect(body.phone_result.total_m).toBeGreaterThan(400);
      expect(body.phone_result.input_digest).toMatch(/^[0-9a-f]{16}$/);
      expect(body).not.toHaveProperty('interruptions');
    });

    it('a retried end sends the same extras', async () => {
      let up = false;
      const routes = server({
        [`POST /shifts/${ID}/end`]: () => (up ? json(200, {}) : problem(503, 'x', true)),
      });
      const { services, tracker, clock } = setup(routes);
      await services.shift.start({ vehicleId: 3 });
      drive(tracker);
      clock.t = 100_000;
      await services.shift.end();
      up = true;
      await services.shift.sync();
      const [a, b] = endBody(routes);
      expect(b).toEqual(a);
      expect(a.phone_result).toBeDefined();
    });

    it('no stored points or tracking off: just ended_at', async () => {
      const none = server();
      const a = setup(none);
      await a.services.shift.start({ vehicleId: 3 });
      await a.services.shift.end();
      expect(endBody(none)).toEqual([{ ended_at: 1_000 }]);

      const off = server();
      const b = setup(off, { paired: { modules: { tracking: false } } });
      await b.services.shift.start({ vehicleId: 3 });
      await b.services.shift.end();
      expect(endBody(off)).toEqual([{ ended_at: 1_000 }]);
    });

    it('an engine failure never blocks the end', async () => {
      const routes = server();
      const { services, tracker } = setup(routes);
      await services.shift.start({ vehicleId: 3 });
      drive(tracker);
      jest.spyOn(tracker, 'readByShift').mockImplementation(() => {
        throw new Error('boom');
      });
      expect(await services.shift.end()).toEqual({ ok: true, sent: true });
      expect(endBody(routes)).toEqual([{ ended_at: 1_000 }]);
    });
  });

  it('ApiError is exported for callers', () => {
    expect(new ApiError(500, 'x', true)).toBeInstanceOf(Error);
  });
});
