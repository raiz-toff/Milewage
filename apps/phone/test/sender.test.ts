import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { json, makeServices, problem, type Handler } from './support/mock';
import { openNodeAppDb } from './support/nodeSql';
import { drive, ID, server, setup, writes } from './support/shiftKit';

const B = '22222222-2222-4222-8222-222222222222';

/**
 * Sending to the server, at the sender's interface (`services.sender`): what the shift controller
 * and the edits queued goes out in order, the end waits for the shift's points, refusals and halts
 * keep everything, and the banner reads one status.
 */

/** A shift recorded and ended with no connection: its create, readings and end wait on the phone. */
async function endedOffline(
  routes = server(),
  over: { odometerStartM?: number; odometerEndM?: number; points?: boolean } = {},
  opts: Parameters<typeof setup>[1] = { paired: true },
) {
  const ctx = setup(routes, opts);
  ctx.net.up = false;
  await ctx.services.shift.start({ vehicleId: 3, odometerStartM: over.odometerStartM ?? null });
  if (over.points) drive(ctx.tracker);
  ctx.clock.t = 100_000;
  await ctx.services.shift.end({ odometerEndM: over.odometerEndM ?? null });
  expect(await ctx.services.sender.sendNow()).toBe(false);
  ctx.net.up = true;
  return ctx;
}

/** A shift recorded and sent: it is on the server. */
async function sentShift(routes = server()) {
  const ctx = setup(routes);
  await ctx.services.shift.start({ vehicleId: 3 });
  ctx.clock.t = 100_000;
  await ctx.services.shift.end();
  expect(await ctx.services.sender.sendNow()).toBe(true);
  return ctx;
}

describe('sender: the queue goes out in order', () => {
  it('a shift ended offline goes as create, odometer readings, points, then end, with the exact bodies', async () => {
    const { services, routes } = await endedOffline(server(), {
      odometerStartM: 50_000,
      odometerEndM: 55_000,
      points: true,
    });
    expect((await services.sender.status()).unsyncedShifts).toBe(1);
    expect(await services.sender.sendNow()).toBe(true);
    expect(writes(routes.calls)).toEqual([
      'POST /shifts',
      `PUT /shifts/${ID}/odometer/shift_start`,
      `PUT /shifts/${ID}/odometer/shift_end`,
      'POST /telemetry/batch',
      `POST /shifts/${ID}/end`,
    ]);
    const body = (i: number) => routes.calls.filter((c) => c.method !== 'GET')[i]!.body;
    expect(body(0)).toEqual({
      client_id: ID,
      vehicle_id: 3,
      started_at: 1_000,
      segmenter: 'stops',
    });
    expect(body(1)).toEqual({ reading_m: 50_000, recorded_at: 1_000 });
    expect(body(2)).toEqual({ reading_m: 55_000, recorded_at: 100_000 });
    expect(body(4)).toMatchObject({ ended_at: 100_000, manifest: { point_count: 5 } });
    expect(await services.sender.status()).toMatchObject({
      color: 'green',
      unsyncedShifts: 0,
      message: null,
    });
    expect((await services.shifts.get(ID))!.sync_state).toBe('on_server');
  });

  it('a reading changed twice while offline is sent once, with the newer value', async () => {
    const { services, routes } = await endedOffline(server(), { odometerEndM: 55_000 });
    await services.edits.setOdometer(ID, 'shift_end', 56_000);
    await services.edits.setOdometer(ID, 'shift_end', 57_000);
    expect(await services.sender.sendNow()).toBe(true);
    const readings = routes.calls.filter((c) => c.path.endsWith('/odometer/shift_end'));
    expect(readings.map((c) => (c.body as { reading_m: number }).reading_m)).toEqual([57_000]);
    expect(writes(routes.calls).filter((w) => w === `POST /shifts/${ID}/end`)).toHaveLength(1);
  });

  it('an edit made while the earlier one is being sent is not lost: it goes after it', async () => {
    const ref: { edit?: () => Promise<unknown> } = {};
    const routes = server({
      [`PUT /shifts/${ID}/odometer/shift_end`]: async () => {
        await ref.edit?.();
        ref.edit = undefined;
        return json(200, {});
      },
    });
    const { services } = await endedOffline(routes, { odometerEndM: 1_000 });
    ref.edit = () => services.edits.setOdometer(ID, 'shift_end', 2_000);
    expect(await services.sender.sendNow()).toBe(true);
    const readings = routes.calls.filter((c) => c.path.endsWith('/odometer/shift_end'));
    expect(readings.map((c) => (c.body as { reading_m: number }).reading_m)).toEqual([
      1_000, 2_000,
    ]);
  });

  it('one round at a time: a second call waits for the first and then looks again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const routes = server({
      'POST /shifts': async () => {
        await gate;
        return json(201, {});
      },
    });
    const { services } = await endedOffline(routes);
    const first = services.sender.sendNow();
    await new Promise((r) => setTimeout(r, 5));
    const second = services.sender.sendNow();
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(writes(routes.calls)).toEqual(['POST /shifts', `POST /shifts/${ID}/end`]);
  });

  it('not paired: nothing is sent and nothing is lost', async () => {
    const { services, routes } = await endedOffline();
    await services.pairing.unpair();
    const from = routes.calls.length;
    expect(await services.sender.sendNow()).toBe(false);
    expect(routes.calls.length).toBe(from);
    expect((await services.sender.status()).unsyncedShifts).toBe(1);
  });
});

describe('sender: failures keep everything', () => {
  it('a network failure stops the round; the loop tries again after 2 s, 4 s, then the Retry-After', async () => {
    let n = 0;
    const routes = server({
      [`PATCH /shifts/${ID}`]: () => {
        n++;
        if (n === 1) throw new TypeError('offline');
        if (n === 2) return problem(503, 'unavailable', true);
        if (n === 3) return problem(429, 'rate_limited', true, { 'Retry-After': '30' });
        return json(200, {});
      },
    });
    const { services } = await sentShift(routes);
    await services.edits.setNotes(ID, 'flat tyre');
    const patches = () => routes.calls.filter((c) => c.method === 'PATCH').length;
    jest.useFakeTimers();
    try {
      services.sender.start();
      await jest.advanceTimersByTimeAsync(1);
      expect(patches()).toBe(1);
      await jest.advanceTimersByTimeAsync(1_998);
      expect(patches()).toBe(1);
      await jest.advanceTimersByTimeAsync(2);
      expect(patches()).toBe(2);
      await jest.advanceTimersByTimeAsync(3_998);
      expect(patches()).toBe(2);
      await jest.advanceTimersByTimeAsync(2);
      expect(patches()).toBe(3);
      await jest.advanceTimersByTimeAsync(29_998);
      expect(patches()).toBe(3);
      await jest.advanceTimersByTimeAsync(2);
      expect(patches()).toBe(4);
      expect((await services.sender.status()).oldestAt).toBeNull(); // nothing queued any more
      services.sender.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a change the server refuses is kept for the driver to see and holds back only its own shift', async () => {
    let id = 0;
    const ids = [ID, B];
    const routes = server({
      'POST /shifts': (r) =>
        (r.body as { client_id: string }).client_id === ID
          ? problem(409, 'shift_already_active')
          : json(201, {}),
      [`POST /shifts/${B}/end`]: () => json(200, {}),
    });
    const { services, net, clock } = setup(routes, { paired: true, newId: () => ids[id++]! });
    net.up = false;
    for (let i = 0; i < ids.length; i++) {
      await services.shift.start({ vehicleId: 3 });
      clock.t += 60_000;
      await services.shift.end();
    }
    net.up = true;
    expect(await services.sender.sendNow()).toBe(false);
    expect(writes(routes.calls)).toEqual(['POST /shifts', 'POST /shifts', `POST /shifts/${B}/end`]);
    expect((await services.shifts.get(ID))!.sync_state).toBe('needs_attention');
    expect((await services.shifts.get(B))!.sync_state).toBe('on_server');
    expect((await services.sender.status()).color).toBe('red');
    // Never sent again by itself, and the shift's end waits behind it.
    const from = routes.calls.length;
    expect(await services.sender.sendNow()).toBe(false);
    expect(writes(routes.calls, from)).toEqual([]);
  });

  it('409 shift_finalized on an edit is final: it goes from the queue and is not sent again', async () => {
    const routes = server({ [`PATCH /shifts/${ID}`]: () => problem(409, 'shift_finalized') });
    const { services } = await sentShift(routes);
    await services.edits.setNotes(ID, 'late note');
    expect(await services.sender.sendNow()).toBe(true);
    await services.sender.sendNow();
    expect(routes.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('an end sent but not noted before a kill is sent again, identical, after the restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-send-'));
    try {
      const path = join(dir, 'app.db');
      let kill: (() => void) | null = null;
      const routes = server({
        [`POST /shifts/${ID}/end`]: () => {
          kill?.(); // the process dies after the server stored it, before the phone noted it
          return json(200, {});
        },
      });
      const db = openNodeAppDb(path);
      const first = await endedOffline(
        routes,
        { points: true },
        {
          paired: true,
          openAppDb: async () => db,
        },
      );
      kill = () => db.close();
      await expect(first.services.sender.sendNow()).rejects.toThrow();

      kill = null;
      const again = setup(routes, {
        paired: true,
        tracker: first.tracker,
        openAppDb: async () => openNodeAppDb(path),
      });
      expect((await again.services.sender.status()).unsyncedShifts).toBe(1);
      expect(await again.services.sender.sendNow()).toBe(true);
      const ends = routes.calls.filter((c) => c.path === `/shifts/${ID}/end`);
      expect(ends).toHaveLength(2);
      expect(ends[1]!.body).toEqual(ends[0]!.body);
      expect((await again.services.sender.status()).unsyncedShifts).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('what waits survives an app restart and goes when the server is back', async () => {
    const db = openNodeAppDb();
    const first = await endedOffline(
      server(),
      { odometerEndM: 9_000 },
      {
        paired: true,
        openAppDb: async () => db,
      },
    );
    const routes = server();
    const again = makeServices(routes.fetch, { paired: true, openAppDb: async () => db });
    expect(await again.services.sender.sendNow()).toBe(true);
    expect(writes(routes.calls)).toEqual([
      'POST /shifts',
      `PUT /shifts/${ID}/odometer/shift_end`,
      `POST /shifts/${ID}/end`,
    ]);
    void first;
  });
});

describe('sender: the end waits for the points', () => {
  it('telemetry first, then shift.end; a failed batch holds the end back', async () => {
    let up = false;
    const order: string[] = [];
    const routes = server({
      'POST /telemetry/batch': (r) => {
        order.push('telemetry');
        const n = (r.body as { points: unknown[] }).points.length;
        return up
          ? json(200, { inserted: n, duplicates: 0, rejected: [], upload_hint_s: 60 })
          : problem(503, 'x', true);
      },
      [`POST /shifts/${ID}/end`]: () => {
        order.push('end');
        return json(200, {});
      },
    });
    const { services, tracker } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    tracker.emit({ recordedAt: 2000 });
    tracker.emit({ recordedAt: 12_000 });
    expect(await services.shift.end()).toEqual({ ok: true });
    expect(await services.sender.sendNow()).toBe(false);
    expect(order).not.toContain('end');
    expect(tracker.readPending(10)).toHaveLength(2);
    up = true;
    expect(await services.sender.sendNow()).toBe(true);
    expect(order.at(-1)).toBe('end');
    expect(order.filter((o) => o === 'end')).toHaveLength(1);
    expect(tracker.readPending(10)).toHaveLength(0);
  });
});

describe('sender: the device session halts it', () => {
  it('401 device_revoked: nothing more goes out and everything is kept; pairing again sends it all', async () => {
    let revoked = true;
    const answer =
      (ok: Handler): Handler =>
      (r) =>
        revoked ? problem(401, 'device_revoked') : ok(r);
    const routes = server({
      'POST /shifts': answer(() => json(201, {})),
      [`POST /shifts/${ID}/end`]: answer(() => json(200, {})),
    });
    const { services } = await endedOffline(routes);
    expect(await services.sender.sendNow()).toBe(false);
    expect(await services.sender.status()).toMatchObject({ halt: 'repair', color: 'red' });
    const from = routes.calls.length;
    expect(await services.sender.sendNow()).toBe(false);
    expect(writes(routes.calls, from)).toEqual([]); // no shift data while halted
    expect((await services.sender.status()).unsyncedShifts).toBe(1);

    revoked = false;
    await services.pairing.device.resume(); // what pairing again does
    expect(await services.sender.sendNow()).toBe(true);
    expect(writes(routes.calls, from)).toEqual(['POST /shifts', `POST /shifts/${ID}/end`]);
    expect((await services.sender.status()).halt).toBeNull();
  });

  it('"Sync now" lifts the halt and tries once; a server that still refuses halts it again', async () => {
    const routes = server({ 'POST /shifts': () => problem(403, 'scope_forbidden') });
    const { services } = await endedOffline(routes);
    expect(await services.sender.sendNow()).toBe(false);
    expect((await services.sender.status()).halt).toBe('auth_problem');
    const from = routes.calls.length;
    expect(await services.sender.retry()).toBe(false);
    expect(writes(routes.calls, from)).toEqual(['POST /shifts']);
    expect((await services.sender.status()).halt).toBe('auth_problem');
  });
});

describe('sender: one status for the screens', () => {
  it('numbers, colour and sentence for what is on the phone only, and the round in progress', async () => {
    const { services, routes } = await endedOffline(server(), { points: true });
    const s = await services.sender.status();
    expect(s).toMatchObject({
      color: 'yellow',
      unsyncedShifts: 1,
      unsyncedPoints: 5,
      oldestAt: 100_000,
      message: 'Offline. Saved on your phone.',
      halt: null,
      progress: { phase: 'waiting' },
    });
    const phases: string[] = [];
    const off = services.sender.subscribe(
      () => void services.sender.status().then((x) => phases.push(x.progress.phase)),
    );
    await services.sender.sendNow();
    await new Promise((r) => setTimeout(r, 0));
    off();
    expect(phases[0]).toBe('running');
    expect(phases.at(-1)).toBe('done');
    expect(await services.sender.status()).toMatchObject({
      color: 'green',
      unsyncedShifts: 0,
      message: null,
      progress: { phase: 'done', shiftsDone: 1, shiftsTotal: 1, pointsSent: 5, pointsTotal: 5 },
    });
    void routes;
  });

  it('listeners hear a halt and its lift', async () => {
    const { services } = setup();
    const heard = jest.fn();
    const off = services.sender.subscribe(heard);
    await services.pairing.device.halt('auth_problem');
    await services.pairing.device.resume();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    await services.pairing.device.halt('auth_problem');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('the loop sends at once and then on the server hint; stop ends it', async () => {
    const routes = server();
    const { services, tracker, clock } = setup(routes);
    await services.shift.start({ vehicleId: 3 });
    tracker.emit({ recordedAt: 2_000 });
    const posts = () => routes.calls.filter((c) => c.path === '/telemetry/batch').length;
    jest.useFakeTimers();
    try {
      services.sender.start();
      await jest.advanceTimersByTimeAsync(1);
      expect(posts()).toBe(1);
      clock.t = 70_000;
      tracker.emit({ recordedAt: 69_000 });
      await jest.advanceTimersByTimeAsync(60_000);
      expect(posts()).toBe(2);
      services.sender.stop();
      tracker.emit({ recordedAt: 79_000 });
      await jest.advanceTimersByTimeAsync(120_000);
      expect(posts()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
