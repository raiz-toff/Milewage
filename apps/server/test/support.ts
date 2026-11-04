import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildApp,
  createInstanceReader,
  createServerModules,
  openAndMigrate,
  type AppOptions,
} from '../src/index';

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
export function harness(enabled: Record<string, boolean> = {}, extra: Partial<AppOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mw-test-'));
  const db = openAndMigrate(join(dir, 'milewage.db'));
  const clock = { t: 1_800_000_000_000 };
  const modules = createServerModules({
    db,
    now: () => clock.t,
    diagnosticsPath: join(dir, 'diagnostics.db'),
    backupDir: join(dir, 'backups'),
    configDir: join(dir, 'config'),
  });
  let app: ReturnType<typeof buildApp>['fastify'];
  try {
    app = buildApp({
      modules,
      enabled: { core: true, ...enabled },
      logLevel: 'silent',
      now: () => clock.t,
      identity: createInstanceReader(db),
      ...extra,
    }).fastify;
  } catch (e) {
    // An invalid module configuration is refused at start; do not leak the throwaway files.
    db.close();
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
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
    dir,
    clock,
    call,
    /** POST /setup only: the recovery key is shown but not yet confirmed. */
    async signUpUnconfirmed() {
      const res = await call('POST', '/setup', owner);
      return {
        cookie: String(res.headers['set-cookie']).split(';')[0] as string,
        recoveryKey: res.json().recovery_key as string,
      };
    },
    /** Creates the owner, types back the end of the recovery key, and returns the session cookie. */
    async signUp() {
      const res = await call('POST', '/setup', owner);
      const cookie = String(res.headers['set-cookie']).split(';')[0] as string;
      const recoveryKey = res.json().recovery_key as string;
      await call('POST', '/setup/confirm', { last6: recoveryKey.slice(-6) }, { cookie });
      return { cookie, recoveryKey };
    },
    /** Pairs a phone through the real endpoints; returns its id and Authorization header. */
    async pair(cookie: string) {
      const token = (await call('POST', '/pairing-tokens', undefined, { cookie })).json().token;
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pairing/redeem',
        payload: { token, device_name: 'Pixel', platform: 'android' },
      });
      const { device_id: id, device_token: secret } = res.json();
      return { id: id as number, auth: { authorization: `Bearer ${secret}` } };
    },
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export type Harness = ReturnType<typeof harness>;
