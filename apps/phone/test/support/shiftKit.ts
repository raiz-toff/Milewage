import { FakeTracker } from '../../src/tracker/fake';
import { json, makeServices, mockServer, type Handler, type Recorded } from './mock';

export const ID = '11111111-1111-4111-8111-111111111111';
export const SHIFT = { client_id: ID, vehicle_id: 3, started_at: 1_000 };

export function server(over: Record<string, Handler> = {}) {
  return mockServer({
    'GET /vehicles': () => json(200, [{ id: 3, name: 'Civic' }]),
    'POST /shifts': () => json(201, SHIFT),
    [`PUT /shifts/${ID}/odometer/shift_start`]: () => json(200, {}),
    [`PUT /shifts/${ID}/odometer/shift_end`]: () => json(200, {}),
    [`POST /shifts/${ID}/end`]: () => json(200, {}),
    'POST /telemetry/batch': (r) =>
      json(200, {
        inserted: (r.body as { points: unknown[] }).points.length,
        duplicates: 0,
        rejected: [],
        server_time: 1,
        upload_hint_s: 60,
      }),
    ...over,
  });
}

/** Five fixes 111 m apart, 10 s apart: four accepted steps of about 111 m. */
export const drive = (t: FakeTracker, from = 1_000) => {
  for (let i = 0; i < 5; i++) {
    t.emit({ recordedAt: from + i * 10_000, latE7: 400_000_000 + i * 10_000, lonE7: 0 });
  }
};

/**
 * A paired phone on `routes` with a test clock. Jitter is fixed at the middle (backoff 2 s, 4 s,
 * 8 s exactly). `net.up = false` makes every request fail as if the phone had no connection.
 */
export function setup(
  routes = server(),
  over: Parameters<typeof makeServices>[1] = { paired: true },
) {
  const clock = { t: 1_000 };
  const net = { up: true };
  const tracker = new FakeTracker(() => clock.t);
  const made = makeServices(
    (url, init) =>
      net.up ? routes.fetch(url, init) : Promise.reject(new TypeError('Network request failed')),
    {
      paired: true,
      tracker,
      now: () => clock.t,
      newId: () => ID,
      rand: () => 0.5,
      ...over,
    },
  );
  return { ...made, routes, clock, tracker, net };
}

/** `METHOD /path` of each request after the first `from`, reads (GET) left out. */
export const writes = (calls: Recorded[], from = 0) =>
  calls
    .slice(from)
    .filter((c) => c.method !== 'GET')
    .map((c) => `${c.method} ${c.path}`);
