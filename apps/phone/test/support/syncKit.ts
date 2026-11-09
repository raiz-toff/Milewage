import { ApiClient } from '../../src/api/client';
import { migrate } from '../../src/db/appDb';
import { DeviceSession, haltFor } from '../../src/pairing/deviceSession';
import { MemoryStore } from '../../src/pairing/pairing';
import { Outbox } from '../../src/sync/outbox';
import { OutboxRunner, type RunnerDeps } from '../../src/sync/runner';
import type { QueuedChange } from '../../src/sync/shiftRequests';
import { mockServer } from './mock';
import { openNodeAppDb } from './nodeSql';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
/** The id of a manual trip in shift A. */
export const MANUAL = '99999999-9999-4999-8999-999999999999';

/** Changes as the phone queues them, for tests of the outbox and the runner. */
export const create = (clientId: string): QueuedChange => ({
  type: 'shift.create',
  clientId,
  vehicleId: 3,
  startedAt: 1_000,
  segmenter: 'whole_shift',
});

export const end = (clientId: string, endedAt = 9, withResult = false): QueuedChange => ({
  type: 'shift.end',
  clientId,
  endedAt,
  manifest: withResult ? { firstSeq: 1, lastSeq: 5, pointCount: 5 } : null,
  phoneResult: withResult
    ? {
        calcVersion: 1,
        segmenter: 'whole_shift',
        inputDigest: '0123456789abcdef',
        totalM: 5,
        activeM: 5,
        deadheadM: 0,
        personalM: 0,
        tripsCount: 1,
      }
    : null,
});

export const odometer = (
  clientId: string,
  reading: 'shift_start' | 'shift_end',
  readingM: number,
): QueuedChange => ({ type: 'odometer.put', clientId, reading, readingM, recordedAt: 1_000 });

export const override = (
  tripKey: string,
  kind: 'active' | 'deadhead' | 'personal',
  purpose: string,
): QueuedChange => ({ type: 'trip.override', tripKey, kind, purpose, editedAt: 1_000 });

export const manualTrip = (clientId: string, tripKey: string, distanceM: number): QueuedChange => ({
  type: 'trip.manual',
  clientId,
  tripKey,
  kind: 'active',
  startedAt: 1_000,
  endedAt: 2_000,
  distanceM,
  purpose: 'Delivery',
  editedAt: 1_000,
});

export const notes = (clientId: string, text: string, updatedAt = 1_000): QueuedChange => ({
  type: 'shift.patch',
  clientId,
  notes: text,
  updatedAt,
});

type Server = ReturnType<typeof mockServer>;

/** An in-memory app.db, an outbox and a runner against a mock server. */
export async function makeSync(
  server: Server,
  over: Partial<RunnerDeps> & { path?: string; now?: () => number; paired?: boolean } = {},
) {
  const db = openNodeAppDb(over.path);
  await migrate(db);
  const clock = { t: 1_000 };
  const outbox = new Outbox(db, over.now ?? (() => clock.t));
  // The device client as pairing builds it: refusals halt the device session.
  const device = new DeviceSession(new MemoryStore());
  const client = new ApiClient({
    baseUrl: 'https://mw.example.net',
    token: 'mwd_x',
    fetch: server.fetch,
    now: () => clock.t,
    blocked: device.blocked,
    onProblem: (e) => {
      const reason = haltFor(e);
      if (reason) void device.halt(reason);
    },
  });
  const { paired = true, ...rest } = over;
  delete rest.path;
  delete rest.now;
  const runner = new OutboxRunner({
    outbox,
    session: async () => (paired ? { client } : null),
    device,
    rand: () => 0.5,
    ...rest,
  });
  return { db, outbox, runner, clock, client, device };
}
