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

  it('an end that cannot be sent is kept, then retried with the same ended_at after a restart', async () => {
    let up = false;
    const routes = server({
      [`POST /shifts/${ID}/end`]: () => (up ? json(200, {}) : problem(503, 'x', true)),
    });
    const { services, plain, clock } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    clock.t = 7_000;
    expect(await services.shift.end()).toEqual({ ok: true, sent: false });
    expect(services.shift.current?.endedAt).toBe(7_000);

    // New process: same storage, new controller.
    clock.t = 500_000;
    up = true;
    const again = makeServices(routes.fetch, { paired: true, now: () => clock.t });
    again.plain.data.set('shift.active', plain.data.get('shift.active')!);
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

  it('ApiError is exported for callers', () => {
    expect(new ApiError(500, 'x', true)).toBeInstanceOf(Error);
  });
});
