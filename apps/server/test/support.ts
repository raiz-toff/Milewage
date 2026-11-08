import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildApp,
  createInstanceReader,
  createDiskMonitor,
  createServerState,
  createServerModules,
  openAndMigrate,
  type AppOptions,
  type Db,
} from '../src/index';
import type { CommaOptions } from '../src/comma-options';
import type { ExporterRegistry } from '../src/exporters/registry';

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
export function harness(
  enabled: Record<string, boolean> = {},
  extra: Partial<AppOptions> & {
    restoreVerify?: (db: Db) => void;
    lateRecomputeMs?: number;
    archiveEveryMs?: number;
    diagnosticsSampleMs?: number;
    diagnosticsBundle?: boolean;
    captureHousekeepingMs?: number;
    backupOnShiftEnd?: boolean;
    backupDownload?: boolean;
    exporters?: ExporterRegistry;
    comma?: Partial<CommaOptions>;
    diagnosticsHousekeepingMs?: number;
    enabledExportFormats?: () => readonly string[];
    publicUrl?: string | null;
    homeUrl?: string | null;
    httpAddressAllowed?: boolean;
    appStoreUrl?: string | null;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'mw-test-'));
  const db = openAndMigrate(join(dir, 'milewage.db'));
  const clock = { t: 1_800_000_000_000 };
  const state = createServerState();
  // A pretend volume with lots of room; tests lower `volume.free` to walk through the disk rules.
  const volume = {
    free: 100 * 1024 ** 3,
    total: 500 * 1024 ** 3,
    db: undefined as number | undefined,
  };
  const disk = createDiskMonitor({
    dir,
    dbPath: join(dir, 'milewage.db'),
    now: () => clock.t,
    ttlMs: 0,
    statfs: () => ({ free: volume.free, total: volume.total }),
    dbBytes: () => volume.db ?? 1024 * 1024,
  });
  const modules = createServerModules({
    state,
    disk,
    restoreVerify: extra.restoreVerify,
    lateRecomputeMs: extra.lateRecomputeMs,
    archiveEveryMs: extra.archiveEveryMs,
    diagnosticsSampleMs: extra.diagnosticsSampleMs,
    diagnosticsBundle: extra.diagnosticsBundle,
    captureHousekeepingMs: extra.captureHousekeepingMs,
    // Off unless a test asks: a real backup after every shift end would race with the teardown.
    backupOnShiftEnd: extra.backupOnShiftEnd ?? false,
    backupDownload: extra.backupDownload,
    exporters: extra.exporters,
    comma: extra.comma,
    diagnosticsHousekeepingMs: extra.diagnosticsHousekeepingMs,
    enabledExportFormats: extra.enabledExportFormats,
    db,
    now: () => clock.t,
    diagnosticsPath: join(dir, 'diagnostics.db'),
    backupDir: join(dir, 'backups'),
    configDir: join(dir, 'config'),
    apkPath: join(dir, 'config', 'milewage.apk'),
    publicUrl: extra.publicUrl,
    homeUrl: extra.homeUrl,
    httpAddressAllowed: extra.httpAddressAllowed,
    appStoreUrl: extra.appStoreUrl,
  });
  let app: ReturnType<typeof buildApp>['fastify'];
  let bus: ReturnType<typeof buildApp>['bus'];
  try {
    const built = buildApp({
      modules,
      enabled: { core: true, ...enabled },
      logLevel: 'silent',
      now: () => clock.t,
      identity: createInstanceReader(db),
      state,
      disk: () => disk.state(),
      ...extra,
    });
    app = built.fastify;
    bus = built.bus;
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
    bus,
    db,
    dir,
    state,
    volume,
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

/** Modules that depend on `tracking`; switch them off together with it. */
export const TRACKING_OFF = { tracking: false, stops: false, replay: false };
