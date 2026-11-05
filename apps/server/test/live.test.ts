import { afterEach, describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { ride, SHIFT, toWire } from './rides';
import { harness, type Harness } from './support';

let h: Harness;
let cookie: string;
let auth: { authorization: string };
let port: number;
const sockets: WebSocket[] = [];

type Frame = { type: string; [k: string]: unknown };

async function setup(modules: Record<string, boolean> = {}, pingMs?: number) {
  h = harness(modules, { livePingMs: pingMs });
  ({ cookie } = await h.signUp());
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  ({ auth } = await h.pair(cookie));
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  port = (h.app.server.address() as { port: number }).port;
}
/** Opens the feed; resolves once connected, with every frame collected in `frames`. */
function connect(headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/live`, {
    headers: { origin: `http://127.0.0.1:${port}`, cookie, ...headers },
  });
  sockets.push(ws);
  const frames: Frame[] = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d)) as Frame));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once('error', reject);
  });
  return { ws, frames, opened };
}
async function until<T>(f: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out waiting for a frame');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const frame = (frames: Frame[], type: string, from = 0) =>
  until(() => frames.slice(from).find((f) => f.type === type));

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await h.close();
});

describe('GET /live (08 section 6)', () => {
  test('a plain GET is not an upgrade; the upgrade needs a session and the site origin', async () => {
    await setup();
    expect((await h.call('GET', '/live', undefined, { cookie })).json().code).toBe(
      'upgrade_required',
    );
    await expect(connect({ cookie: '' }).opened).rejects.toThrow('401');
    await expect(connect({ origin: 'http://evil.example' }).opened).rejects.toThrow('403');
    await expect(connect({ cookie: '', authorization: auth.authorization }).opened).rejects.toThrow(
      '403',
    );
  });

  test('hello carries the server time, no active shift and every device state', async () => {
    await setup();
    const c = connect();
    await c.opened;
    const hello = await frame(c.frames, 'hello');
    expect(hello).toEqual({
      type: 'hello',
      server_time: h.clock.t,
      active_shift: null,
      device_online: { 1: false },
    });
  });

  test('the feed follows a shift: started, positions (throttled), device online, ended with stops', async () => {
    await setup();
    const c = connect();
    await c.opened;
    await frame(c.frames, 'hello');
    const t0 = h.clock.t;
    const fixes = ride(t0);
    const endedAt = t0 + 313 * 5000;

    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    const started = await until(() =>
      c.frames.find((f) => f.type === 'shift' && f.event === 'started'),
    );
    expect(started.shift).toMatchObject({ client_id: SHIFT, status: 'active' });

    h.clock.t = endedAt + 60_000;
    const post = (from: number, to: number) =>
      h.call(
        'POST',
        '/telemetry/batch',
        { shift_client_id: SHIFT, points: fixes.slice(from, to).map(toWire) },
        auth,
      );
    await post(0, 100);
    const position = await frame(c.frames, 'position');
    expect(position).toMatchObject({
      shift_id: 1,
      seq: 100,
      lat_e7: fixes[99]!.latE7,
      lon_e7: fixes[99]!.lonE7,
    });
    const device = await frame(c.frames, 'device');
    expect(device).toMatchObject({ device_id: 1, state: 'online', last_seen_at: h.clock.t });

    await post(100, 200); // within 2 s of the last position: dropped
    h.clock.t += 3000;
    await post(200, 312);
    await until(() =>
      c.frames.filter((f) => f.type === 'position').length === 2 ? true : undefined,
    );
    expect(c.frames.filter((f) => f.type === 'position').map((f) => f.seq)).toEqual([100, 312]);

    const before = c.frames.length;
    await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: endedAt }, auth);
    const ended = await until(() =>
      c.frames.slice(before).find((f) => f.type === 'shift' && f.event === 'ended'),
    );
    expect(ended.shift).toMatchObject({ status: 'ended', total_m: expect.any(Number) });
    const stops = await frame(c.frames, 'stops', before);
    expect(stops).toMatchObject({ shift_id: 1 });
    expect(stops.stops).toHaveLength(1);
    expect((stops.stops as { label: unknown }[])[0]!.label).toBeNull();

    // A label on the web recomputes and pushes the stops again.
    const key = encodeURIComponent((stops.stops as { stop_key: string }[])[0]!.stop_key);
    const after = c.frames.length;
    await h.call(
      'PUT',
      `/shifts/${SHIFT}/stop-labels/${key}`,
      { role: 'dropoff', edited_at: h.clock.t },
      { cookie },
    );
    const relabelled = await frame(c.frames, 'stops', after);
    expect((relabelled.stops as { role: string }[])[0]!.role).toBe('dropoff');
    await until(() =>
      c.frames.slice(after).find((f) => f.type === 'shift' && f.event === 'updated'),
    );
  });

  test('a phone that stops calling is announced offline by the next sweep', async () => {
    await setup({}, 30);
    const c = connect();
    await c.opened;
    await frame(c.frames, 'hello');
    const t0 = h.clock.t;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: ride(t0).slice(0, 5).map(toWire) },
      auth,
    );
    await until(() => c.frames.find((f) => f.type === 'device' && f.state === 'online'));
    h.clock.t += 4 * 60_000;
    const off = await until(() =>
      c.frames.find((f) => f.type === 'device' && f.state === 'offline'),
    );
    expect(off).toMatchObject({ device_id: 1 });
  });

  test('with the stops setting off no stops frame is sent', async () => {
    await setup();
    await h.call('PATCH', '/settings', { stops_enabled: false }, { cookie });
    const c = connect();
    await c.opened;
    await frame(c.frames, 'hello');
    const t0 = h.clock.t;
    const fixes = ride(t0);
    h.clock.t = t0 + 313 * 5000 + 60_000;
    await h.call('POST', '/shifts', { client_id: SHIFT, vehicle_id: 1, started_at: t0 }, auth);
    await h.call(
      'POST',
      '/telemetry/batch',
      { shift_client_id: SHIFT, points: fixes.slice(0, 100).map(toWire) },
      auth,
    );
    await h.call('POST', `/shifts/${SHIFT}/end`, { ended_at: t0 + 600_000 }, auth);
    await until(() => c.frames.find((f) => f.type === 'shift' && f.event === 'ended'));
    expect(c.frames.some((f) => f.type === 'stops')).toBe(false);
  });

  test('hello shows the active shift to a client that connects mid-shift', async () => {
    await setup();
    await h.call(
      'POST',
      '/shifts',
      { client_id: SHIFT, vehicle_id: 1, started_at: h.clock.t },
      auth,
    );
    const c = connect();
    await c.opened;
    const hello = await frame(c.frames, 'hello');
    expect(hello.active_shift).toMatchObject({ client_id: SHIFT, status: 'active', flags: [] });
  });

  test('ping every interval; a client that never answers is closed after 2 missed pongs, one that answers stays', async () => {
    await setup({}, 40);
    const silent = connect();
    const polite = connect();
    polite.ws.on('message', (d) => {
      if ((JSON.parse(String(d)) as Frame).type === 'ping')
        polite.ws.send(JSON.stringify({ type: 'pong' }));
    });
    await Promise.all([silent.opened, polite.opened]);
    const closed = new Promise<number>((r) => silent.ws.once('close', r));
    await closed;
    expect(silent.frames.filter((f) => f.type === 'ping').length).toBeGreaterThanOrEqual(2);
    expect(polite.ws.readyState).toBe(WebSocket.OPEN);
    expect(polite.frames.filter((f) => f.type === 'ping').length).toBeGreaterThanOrEqual(3);
  });

  test('live off: no route, and an upgrade is not answered', async () => {
    await setup({ live: false });
    expect((await h.call('GET', '/live', undefined, { cookie })).json().code).toBe('not_found');
    await expect(connect().opened).rejects.toThrow();
  });
});

describe('closing the server', () => {
  test('open feeds do not keep it from closing', async () => {
    await setup();
    const c = connect();
    await c.opened;
    await frame(c.frames, 'hello');
  });
});
