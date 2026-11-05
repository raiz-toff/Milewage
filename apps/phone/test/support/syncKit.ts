import { ApiClient } from '../../src/api/client';
import { migrate } from '../../src/db/appDb';
import { Outbox } from '../../src/sync/outbox';
import { OutboxRunner, type RunnerDeps } from '../../src/sync/runner';
import { mockServer } from './mock';
import { openNodeAppDb } from './nodeSql';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';

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
  const client = new ApiClient({
    baseUrl: 'https://mw.example.net',
    token: 'mwd_x',
    fetch: server.fetch,
    now: () => clock.t,
  });
  const { paired = true, ...rest } = over;
  delete rest.path;
  delete rest.now;
  const runner = new OutboxRunner({
    outbox,
    session: async () => (paired ? { client } : null),
    rand: () => 0.5,
    ...rest,
  });
  return { db, outbox, runner, clock, client };
}
