import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { json, mockServer, problem } from './support/mock';
import {
  A,
  B,
  create,
  end,
  makeSync,
  MANUAL,
  manualTrip,
  notes,
  odometer,
  override,
} from './support/syncKit';

const ok = () => json(200, {});
const routes = (over: Record<string, () => Response | Promise<Response>> = {}) =>
  mockServer({
    'POST /shifts': () => json(201, {}),
    [`POST /shifts/${A}/end`]: ok,
    [`POST /shifts/${B}/end`]: ok,
    [`PUT /shifts/${A}/odometer/shift_end`]: ok,
    [`PUT /shifts/${A}/odometer/shift_start`]: ok,
    [`PATCH /shifts/${A}`]: ok,
    ...over,
  });

describe('outbox: queue', () => {
  it('keeps send order, stores the exact body and counts what is waiting', async () => {
    const { outbox, clock } = await makeSync(routes());
    await outbox.enqueue(create(A));
    clock.t = 2_000;
    await outbox.enqueue(end(A, 5));
    const items = await outbox.pending();
    expect(items.map((i) => i.kind)).toEqual(['shift.create', 'shift.end']);
    expect(items[0]!.body).toEqual({
      client_id: A,
      vehicle_id: 3,
      started_at: 1_000,
      segmenter: 'whole_shift',
    });
    expect(await outbox.counts()).toEqual({ pending: 2, parked: 0, oldestAt: 1_000 });
    expect(await outbox.has('shift.end', A)).toBe(true);
    expect(await outbox.has('shift.end', B)).toBe(false);
  });

  it('coalesces odometer, override and manual-trip writes in place, never create or end', async () => {
    const { outbox } = await makeSync(routes());
    const tk = `${A}:1000:active`;
    await outbox.enqueue(create(A));
    await outbox.enqueue(odometer(A, 'shift_end', 1));
    await outbox.enqueue(odometer(A, 'shift_end', 2));
    await outbox.enqueue(odometer(A, 'shift_start', 7));
    await outbox.enqueue(override(tk, 'active', 'a'));
    await outbox.enqueue(override(tk, 'personal', 'b'));
    await outbox.enqueue(manualTrip(A, MANUAL, 1));
    await outbox.enqueue(manualTrip(A, MANUAL, 2));
    await outbox.enqueue(create(A));
    await outbox.enqueue(end(A, 1));
    await outbox.enqueue(end(A, 2));
    const items = await outbox.pending();
    expect(items.map((i) => [i.kind, i.body])).toEqual([
      ['shift.create', expect.objectContaining({ client_id: A })],
      ['odometer.put', { reading_m: 2, recorded_at: 1_000 }],
      ['odometer.put', { reading_m: 7, recorded_at: 1_000 }],
      ['trip.override', { kind: 'personal', purpose: 'b', edited_at: 1_000 }],
      ['trip.manual', expect.objectContaining({ distance_m: 2 })],
      ['shift.create', expect.objectContaining({ client_id: A })],
      ['shift.end', { ended_at: 1 }],
      ['shift.end', { ended_at: 2 }],
    ]);
  });

  it('does not rewrite an item that is being sent: the newer edit is queued behind it', async () => {
    const ref: { outbox?: Awaited<ReturnType<typeof makeSync>>['outbox'] } = {};
    const server = routes({
      [`PUT /shifts/${A}/odometer/shift_end`]: async () => {
        await ref.outbox!.enqueue(odometer(A, 'shift_end', 2));
        return json(200, {});
      },
    });
    const made = await makeSync(server);
    const outbox = made.outbox;
    ref.outbox = outbox;
    await outbox.enqueue(odometer(A, 'shift_end', 1));
    const r = await made.runner.run();
    expect(r.sent).toBe(1);
    expect((server.calls[0]!.body as { reading_m: number }).reading_m).toBe(1);
    const left = await outbox.pending();
    expect(left.map((i) => i.body)).toEqual([{ reading_m: 2, recorded_at: 1_000 }]);
    await made.runner.run();
    expect(server.calls.map((c) => (c.body as { reading_m: number }).reading_m)).toEqual([1, 2]);
  });
});

describe('outbox: runner', () => {
  it('sends in order, deletes what the server acknowledged and reports the applied header', async () => {
    const seen: [string, boolean][] = [];
    const server = routes({
      [`PATCH /shifts/${A}`]: () => json(200, {}, { 'X-MileWage-Applied': 'false' }),
    });
    const { outbox, runner } = await makeSync(server, {
      onSent: ({ item, applied }) => void seen.push([item.kind, applied]),
    });
    await outbox.enqueue(create(A));
    await outbox.enqueue(notes(A, 'n'));
    await outbox.enqueue(end(A, 9));
    const r = await runner.run();
    expect(r).toEqual({ state: 'idle', sent: 3, parked: 0, retryInMs: null });
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /shifts',
      `PATCH /shifts/${A}`,
      `POST /shifts/${A}/end`,
    ]);
    expect(server.calls[2]!.body).toEqual({ ended_at: 9 });
    expect(seen).toEqual([
      ['shift.create', true],
      ['shift.patch', false],
      ['shift.end', true],
    ]);
    expect(await outbox.counts()).toEqual({ pending: 0, parked: 0, oldestAt: null });
  });

  it('stops at a network failure, keeps the item and backs off 2 s, 4 s, then honours Retry-After', async () => {
    let n = 0;
    const server = routes({
      'POST /shifts': () => {
        n++;
        if (n === 1) throw new TypeError('offline');
        if (n === 2) return problem(503, 'unavailable', true);
        if (n === 3) return problem(429, 'rate_limited', true, { 'Retry-After': '30' });
        return json(201, {});
      },
    });
    const { outbox, runner } = await makeSync(server);
    await outbox.enqueue(create(A));
    await outbox.enqueue(end(A));
    const first = await runner.run();
    expect(first).toMatchObject({ state: 'offline', sent: 0, retryInMs: 2000 });
    expect(server.calls.length).toBe(1);
    expect((await runner.run()).retryInMs).toBe(4000);
    expect((await runner.run()).retryInMs).toBe(30_000);
    const items = await outbox.pending();
    expect(items.map((i) => [i.kind, i.attempts, i.lastError])).toEqual([
      ['shift.create', 3, 'rate_limited'],
      ['shift.end', 0, null],
    ]);
    expect((await runner.run()).state).toBe('idle');
    expect((await outbox.counts()).pending).toBe(0);
  });

  it('parks a refused item, holds back that shift only, and sends again after retryParked', async () => {
    let refuse = true;
    const server = routes({
      'POST /shifts': (() => {
        let call = 0;
        return () =>
          ++call === 1 && refuse ? problem(409, 'shift_already_active') : json(201, {});
      })(),
    });
    const parked: string[] = [];
    const { outbox, runner } = await makeSync(server, {
      onParked: (i, e) => void parked.push(`${i.kind}:${e.code}`),
    });
    await outbox.enqueue(create(A));
    await outbox.enqueue(end(A));
    await outbox.enqueue(end(B));
    const r = await runner.run();
    expect(r).toMatchObject({ sent: 1, parked: 1, state: 'idle' });
    expect(parked).toEqual(['shift.create:shift_already_active']);
    expect(server.calls.map((c) => c.path)).toEqual(['/shifts', `/shifts/${B}/end`]);
    // A's end waits behind the parked create, also on later runs.
    await runner.run();
    expect(server.calls.length).toBe(2);
    expect((await outbox.parked())[0]!.lastError).toBe('shift_already_active');
    refuse = false;
    expect(await outbox.retryParked(A)).toBe(1);
    expect((await runner.run()).sent).toBe(2);
    expect((await outbox.counts()).parked).toBe(0);
  });

  it('treats 409 shift_finalized as final for an edit: the row goes, nothing else is sent for it', async () => {
    const server = routes({ [`PATCH /shifts/${A}`]: () => problem(409, 'shift_finalized') });
    const outcomes: string[] = [];
    const { outbox, runner } = await makeSync(server, {
      onSent: (s) => void outcomes.push(s.outcome),
    });
    await outbox.enqueue(notes(A, 'x'));
    expect((await runner.run()).parked).toBe(0);
    expect(outcomes).toEqual(['finalized']);
    expect((await outbox.counts()).pending).toBe(0);
  });

  it('halts on 401 device_revoked with everything kept, and resumes after re-pairing', async () => {
    let revoked = true;
    const server = routes({
      'POST /shifts': () => (revoked ? problem(401, 'device_revoked') : json(201, {})),
    });
    const { outbox, runner, device } = await makeSync(server);
    await outbox.enqueue(create(A));
    await outbox.enqueue(end(A));
    expect((await runner.run()).state).toBe('halted');
    expect(await device.halted()).toBe('repair');
    expect((await runner.run()).state).toBe('halted');
    expect(server.calls.length).toBe(1);
    expect((await outbox.counts()).pending).toBe(2);
    revoked = false;
    await device.resume(); // what pairing again does
    expect((await runner.run()).sent).toBe(2);
  });

  it('holds an item and the rest of its shift while the barrier says no', async () => {
    let barrier = false;
    const server = routes();
    const { outbox, runner } = await makeSync(server, {
      canSend: (i) => i.kind !== 'shift.end' || barrier,
    });
    await outbox.enqueue(create(A));
    await outbox.enqueue(end(A));
    await outbox.enqueue(odometer(A, 'shift_end', 1));
    await outbox.enqueue(end(B));
    barrier = false;
    await runner.run();
    expect(server.calls.map((c) => c.path)).toEqual(['/shifts']);
    barrier = true;
    await runner.run();
    expect(server.calls.map((c) => c.path)).toEqual([
      '/shifts',
      `/shifts/${A}/end`,
      `/shifts/${A}/odometer/shift_end`,
      `/shifts/${B}/end`,
    ]);
  });

  it('can be limited to one shift', async () => {
    const server = routes();
    const { outbox, runner } = await makeSync(server);
    await outbox.enqueue(end(B));
    await outbox.enqueue(end(A));
    await runner.run({ shift: A });
    expect(server.calls.map((c) => c.path)).toEqual([`/shifts/${A}/end`]);
  });

  it('sends one request at a time and does nothing when not paired', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const server = routes({
      'POST /shifts': async () => {
        await gate;
        return json(201, {});
      },
    });
    const { outbox, runner } = await makeSync(server);
    await outbox.enqueue(create(A));
    const first = runner.run();
    await new Promise((r) => setTimeout(r, 5));
    expect((await runner.run()).state).toBe('busy');
    release();
    expect((await first).sent).toBe(1);
    expect(server.calls.length).toBe(1);

    const unpaired = await makeSync(routes(), { paired: false });
    await unpaired.outbox.enqueue(end(A));
    expect((await unpaired.runner.run()).state).toBe('not_paired');
    expect((await unpaired.outbox.counts()).pending).toBe(1);
  });
});

describe('outbox: kill and resume', () => {
  it('resends the identical request after a kill between the answer and the delete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-ob-'));
    try {
      const path = join(dir, 'app.db');
      let kill: (() => void) | null = null;
      const server = routes({
        [`POST /shifts/${A}/end`]: () => {
          kill?.(); // the process dies after the server stored it, before the phone noted it
          return json(200, {});
        },
      });
      const first = await makeSync(server, { path });
      kill = () => first.db.close();
      await first.outbox.enqueue(end(A, 9, true));
      await expect(first.runner.run()).rejects.toThrow();

      kill = null;
      const second = await makeSync(server, { path });
      expect((await second.outbox.pending()).length).toBe(1);
      expect((await second.runner.run()).sent).toBe(1);
      const sends = server.calls.filter((c) => c.path === `/shifts/${A}/end`);
      expect(sends.length).toBe(2);
      expect(sends[1]!.body).toEqual(sends[0]!.body);
      expect((await second.outbox.counts()).pending).toBe(0);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a pending row across a restart and a retryable failure never loses it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-ob-'));
    try {
      const path = join(dir, 'app.db');
      const down = routes({ 'POST /shifts': () => problem(503, 'unavailable', true) });
      const first = await makeSync(down, { path });
      await first.outbox.enqueue(create(A));
      await first.outbox.enqueue(end(A, 1));
      await first.runner.run();
      first.db.close();

      const up = routes();
      const second = await makeSync(up, { path });
      expect((await second.outbox.pending()).map((i) => i.kind)).toEqual([
        'shift.create',
        'shift.end',
      ]);
      expect((await second.runner.run()).sent).toBe(2);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
