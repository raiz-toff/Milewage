import { FakeTracker } from '../../src/tracker/fake';
import { json, makeServices, mockServer, type Handler } from './mock';

export const ID = '11111111-1111-4111-8111-111111111111';
export const SHIFT = { client_id: ID, vehicle_id: 3, started_at: 1_000 };

export function server(over: Record<string, Handler> = {}) {
  return mockServer({
    'GET /vehicles': () => json(200, [{ id: 3, name: 'Civic' }]),
    'POST /shifts': () => json(201, SHIFT),
    [`PUT /shifts/${ID}/odometer/shift_start`]: () => json(200, {}),
    [`PUT /shifts/${ID}/odometer/shift_end`]: () => json(200, {}),
    [`POST /shifts/${ID}/end`]: () => json(200, {}),
    ...over,
  });
}

/** Five fixes 111 m apart, 10 s apart: four accepted steps of about 111 m. */
export const drive = (t: FakeTracker, from = 1_000) => {
  for (let i = 0; i < 5; i++) {
    t.emit({ recordedAt: from + i * 10_000, latE7: 400_000_000 + i * 10_000, lonE7: 0 });
  }
};

export function setup(
  routes = server(),
  over: Parameters<typeof makeServices>[1] = { paired: true },
) {
  const clock = { t: 1_000 };
  const tracker = new FakeTracker(() => clock.t);
  const made = makeServices(routes.fetch, {
    paired: true,
    tracker,
    now: () => clock.t,
    newId: () => ID,
    ...over,
  });
  return { ...made, routes, clock, tracker };
}
