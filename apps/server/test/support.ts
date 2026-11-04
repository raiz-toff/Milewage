import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, createServerModules, openAndMigrate } from '../src/index';

export const owner = {
  username: 'sam',
  password: 'correct horse battery',
  country: 'us',
  distance_unit: 'mi',
  currency: 'usd',
  timezone: 'America/Chicago',
};
const site = { host: 'mw.test', origin: 'http://mw.test' };

/** A server on a throwaway database with an injectable clock. Call `close()` in afterEach. */
export function harness(enabled: Record<string, boolean> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mw-test-'));
  const db = openAndMigrate(join(dir, 'milewage.db'));
  const clock = { t: 1_800_000_000_000 };
  const modules = createServerModules({ db, now: () => clock.t });
  const app = buildApp({
    modules,
    enabled: { core: true, ...enabled },
    logLevel: 'silent',
  }).fastify;
  const call = (method: string, url: string, payload?: object, headers: object = {}) =>
    app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      payload,
      headers: { ...(method === 'GET' ? {} : site), ...headers },
    });
  return {
    app,
    db,
    clock,
    call,
    /** Creates the owner through POST /setup and returns the session cookie. */
    async signUp() {
      const res = await call('POST', '/setup', owner);
      return { cookie: String(res.headers['set-cookie']).split(';')[0] as string };
    },
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type Harness = ReturnType<typeof harness>;
