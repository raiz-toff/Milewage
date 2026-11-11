import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleServer,
  createDiskMonitor,
  createServerState,
  loadConfig,
  openAndMigrate,
  serverExporters,
  type ServerConfig,
  type ServerTuning,
} from '../src/index';
import { COMMA_DEFAULTS, type CommaOptions } from '../src/comma-options';

export const owner = {
  username: 'sam',
  password: 'correct horse battery',
  country: 'us',
  distance_unit: 'mi',
  currency: 'usd',
  timezone: 'America/Chicago',
};
const site = { host: 'mw.test', origin: 'http://mw.test' };

/** Settings a test may change; each is the `ServerConfig` field of the same meaning. */
type TestConfig = Partial<
  Pick<ServerConfig, 'publicUrl' | 'homeUrl' | 'httpAddressAllowed' | 'appStoreUrl' | 'trustProxy'>
> & {
  comma?: Partial<CommaOptions>;
  /** `backup.on_shift_end`; off unless a test asks: a real backup after every shift end would race with the teardown. */
  backupOnShiftEnd?: boolean;
  backupDownload?: boolean;
  diagnosticsBundle?: boolean;
  /** `modules.export_<format>`: only these formats are switched on. */
  enabledExportFormats?: () => readonly string[];
};

/**
 * The production server (`assembleServer`) on a throwaway folder and database, with an injectable
 * clock and a pretend disk. Call `close()` in afterEach.
 */
export function harness(
  enabled: Record<string, boolean> = {},
  extra: TestConfig & ServerTuning = {},
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
  const {
    comma,
    backupOnShiftEnd,
    backupDownload,
    diagnosticsBundle,
    enabledExportFormats,
    publicUrl,
    homeUrl,
    httpAddressAllowed,
    appStoreUrl,
    trustProxy,
    ...tuning
  } = extra;
  const exporters = tuning.exporters ?? serverExporters();
  const formatsOn = enabledExportFormats?.();
  // Every folder inside the throwaway one; the rest is what an empty settings.json gives.
  const base = loadConfig({
    MILEWAGE_DATA_DIR: dir,
    MILEWAGE_CONFIG_DIR: join(dir, 'config'),
    MILEWAGE_BACKUP_DIR: join(dir, 'backups'),
    MILEWAGE_LOG_LEVEL: 'silent',
  });
  const config: ServerConfig = {
    ...base,
    publicUrl: publicUrl ?? base.publicUrl,
    homeUrl: homeUrl ?? base.homeUrl,
    httpAddressAllowed: httpAddressAllowed ?? base.httpAddressAllowed,
    appStoreUrl: appStoreUrl ?? base.appStoreUrl,
    trustProxy: trustProxy ?? base.trustProxy,
    settings: {
      modules: {
        core: true,
        ...enabled,
        ...(formatsOn &&
          Object.fromEntries(
            exporters.formats().map((f) => [`export_${f}`, formatsOn.includes(f)]),
          )),
      },
    },
    comma: { ...COMMA_DEFAULTS, ...comma },
    backup: { onShiftEnd: backupOnShiftEnd ?? false, download: backupDownload ?? true },
    diagnostics: { bundle: diagnosticsBundle ?? true },
  };
  let built: ReturnType<typeof assembleServer>;
  try {
    built = assembleServer({ db, config, now: () => clock.t, state, disk, tuning });
  } catch (e) {
    // An invalid module configuration is refused at start; do not leak the throwaway files.
    db.close();
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const { fastify: app, bus } = built;
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
export const TRACKING_OFF = { tracking: false, stops: false };
