import { createReadStream, readFileSync, statSync } from 'node:fs';
import type { FastifyRequest } from 'fastify';
import { isHomeAddress, type RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import { hashToken, newToken, type Authenticator } from '../auth/authenticator';
import { FailureLimiter } from '../auth/limiter';
import { createDeviceRepository, type Db, type DeviceRow } from '../db';
import { ProblemError } from '../errors';
import { checkPublicUrl, type BaseUrlSource } from '../public-url';
import { idParams, str, strictObject } from './util';

const redeemSchema = strictObject(
  {
    token: str(1, 100),
    device_name: str(1, 64),
    platform: { enum: ['android', 'ios'] },
    app_version: str(0, 32),
  },
  ['token', 'device_name', 'platform'],
);
const renameSchema = strictObject({ name: str(1, 64) }, ['name']);
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v?.split(',')[0]?.trim();
const fileStat = (path: string) => {
  try {
    const s = statSync(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
};
const fileSize = (path: string) => fileStat(path)?.size ?? null;
/** The version the build script writes next to the app file (`<file>.json`); null when absent or odd. */
const apkVersion = (path: string): string | null => {
  try {
    const v: unknown = (JSON.parse(readFileSync(`${path}.json`, 'utf8')) as { version?: unknown })
      .version;
    return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : null;
  } catch {
    return null;
  }
};
interface Found {
  url: string;
  source: BaseUrlSource;
}
interface Addresses extends Found {
  home: string | null;
  away: string | null;
}
const view = (d: DeviceRow, skew?: number) => ({
  id: d.id,
  name: d.name,
  platform: d.platform,
  created_at: d.createdAt,
  last_seen_at: d.lastSeenAt,
  revoked_at: d.revokedAt,
  clock_skew_ms: skew ?? null,
});

export interface DevicesContext {
  db: Db;
  now: () => number;
  authn: Authenticator;
  /** Core service: the `Settings` response, returned to a phone when it pairs. */
  readSettings: (host: ServerRouteHost) => (userId: number) => object;
  /** The phone app file, served by `GET /app/android.apk` when it exists (plan 24 Q2). */
  apkPath?: string;
  /** `MILEWAGE_PUBLIC_URL`: the address phones are given; null or absent to use the request's. */
  publicUrl?: string | null;
  /** `MILEWAGE_HOME_URL`: the server on the home network (plan 28); null to use a home request's. */
  homeUrl?: string | null;
  /** Accept a plain http address from the driver (development only). */
  httpAddressAllowed?: boolean;
  /** `MILEWAGE_APP_STORE_URL`: the app's store page; null until the app is published. */
  appStoreUrl?: string | null;
}

/** Pairing, device credentials and the device list (08 section 2.4). */
export function devicesRoutes({
  db,
  now,
  authn,
  readSettings,
  apkPath,
  publicUrl,
  homeUrl = null,
  httpAddressAllowed = process.env.NODE_ENV !== 'production',
  appStoreUrl = null,
}: DevicesContext) {
  return (routeHost: RouteHost) => {
    const host = routeHost as ServerRouteHost;
    const { app } = host;
    const auth = authn.authenticate;
    const repo = createDeviceRepository(db);
    const limiter = new FailureLimiter(10, 15 * 60 * 1000, now);
    const settings = readSettings(host);

    const skews = new Map<number, number>(); // device id -> last phone-minus-server clock difference, in memory only
    authn.useDeviceBranch((tokenHash, request) => {
      const d = repo.findByTokenHash(tokenHash);
      if (!d) throw new ProblemError('auth_required', 'Unknown credential.');
      if (d.revokedAt !== null) throw new ProblemError('device_revoked', 'This phone was revoked.');
      const t = now();
      const sent = Number(request.headers['x-client-time']);
      if (Number.isSafeInteger(sent) && sent > 0) skews.set(d.id, sent - t);
      if (d.lastSeenAt === null || t - d.lastSeenAt >= 60_000) repo.seen(d.id, t); // at most once a minute
      return { kind: 'device', userId: d.userId, deviceId: d.id };
    });

    /**
     * The addresses phones are given (plan 19 section 3.2, plan 28 section 4.2). Away (https):
     * the driver's correction, then `MILEWAGE_PUBLIC_URL`, then this request's address when it is
     * https and not on the home network. Home (http allowed): the driver's correction when it is a
     * home address, then `MILEWAGE_HOME_URL`, then this request's address when it is one. `url`,
     * the address in the code, is the away address, else the home one, else this request's.
     */
    const address = (req: FastifyRequest, driver?: string): Addresses => {
      const proto = first(req.headers['x-forwarded-proto']) ?? 'http';
      const seen = `${proto}://${first(req.headers['x-forwarded-host']) ?? req.headers.host}`;
      const seenHome = isHomeAddress(seen);
      let away: Found | null = publicUrl
        ? { url: publicUrl, source: 'configured' }
        : proto === 'https' && !seenHome
          ? { url: seen, source: 'request' }
          : null;
      let home: Found | null = homeUrl
        ? { url: homeUrl, source: 'configured' }
        : seenHome
          ? { url: seen, source: 'request' }
          : null;
      if (driver !== undefined) {
        const checked = checkPublicUrl(driver, httpAddressAllowed, true);
        if ('error' in checked) {
          throw new ProblemError('validation_failed', checked.error, [
            { path: '/base_url', message: checked.error },
          ]);
        }
        const found: Found = { url: checked.url, source: 'driver' };
        if (isHomeAddress(checked.url)) home = found;
        else away = found;
      }
      const main = away ?? home ?? { url: seen, source: 'request' };
      return { ...main, home: home?.url ?? null, away: away?.url ?? null };
    };

    app.post('/pairing-tokens', { bodyLimit: 4096 }, async (req, reply) => {
      const { userId } = auth(req, 'S');
      const asked = (req.body ?? {}) as { base_url?: unknown };
      if (asked.base_url !== undefined && typeof asked.base_url !== 'string') {
        throw new ProblemError('validation_failed', 'base_url must be text.');
      }
      const { url: base, source, home, away } = address(req, asked.base_url);
      const token = newToken('mwp_');
      const createdAt = now();
      const expiresAt = createdAt + 10 * 60 * 1000;
      repo.addPairingToken({ userId, tokenHash: hashToken(token), createdAt, expiresAt });
      // `h`, the home address, is new in plan 28 and optional: an older app reads only `u`.
      const h = home && home !== base ? `&h=${encodeURIComponent(home)}` : '';
      const qr = `milewage://pair?v=1&u=${encodeURIComponent(base)}&t=${token}${h}`;
      // The QR carries the https form: the phone app reads it, and so does any camera app, which
      // opens the server's /pair page. The token is in the fragment, so no server log sees it.
      const pairUrl = `${base}/pair#v=1&t=${token}${h}`;
      return reply.status(201).send({
        token,
        expires_at: expiresAt,
        qr_payload: qr,
        pair_url: pairUrl,
        base_url: base,
        base_url_source: source,
        home_url: home,
        away_url: away,
      });
    });

    // What the download page shows (no sign-in: the phone has no account yet). The file is looked
    // at on every request, so a new build put in place is offered without a restart.
    app.get('/app', async (req, reply) => {
      const stat = apkPath ? fileStat(apkPath) : null;
      const { url, source } = address(req);
      return reply.header('Cache-Control', 'no-store').send({
        apk: stat
          ? {
              size_bytes: stat.size,
              updated_at: Math.round(stat.mtimeMs),
              version: apkVersion(apkPath!),
            }
          : null,
        store_url: appStoreUrl,
        page_url: `${url}/app`,
        base_url: url,
        base_url_source: source,
      });
    });

    // The app this server was built with (plan 24 Q2): no sign-in, a phone downloads it before
    // it is paired. Nothing is served until the owner puts the file there (install.md).
    app.get('/app/android.apk', async (_req, reply) => {
      const size = apkPath ? fileSize(apkPath) : null;
      if (size === null) throw new ProblemError('not_found', 'This server has no app file.');
      return reply
        .header('Content-Type', 'application/vnd.android.package-archive')
        .header('Content-Length', size)
        .header('Content-Disposition', 'attachment; filename="milewage.apk"')
        .send(createReadStream(apkPath!));
    });

    app.post(
      '/pairing/redeem',
      { bodyLimit: 4096, schema: { body: redeemSchema } },
      async (req, reply) => {
        const wait = limiter.retryAfter(req.ip);
        if (wait > 0) {
          const headers = { 'Retry-After': String(wait) };
          throw new ProblemError('rate_limited', 'Too many failed attempts.', undefined, headers);
        }
        const b = req.body as {
          token: string;
          device_name: string;
          platform: DeviceRow['platform'];
        };
        const credential = newToken('mwd_');
        const device = repo.redeem(hashToken(b.token), now(), {
          name: b.device_name,
          platform: b.platform,
          tokenHash: hashToken(credential),
        });
        if (!device) {
          limiter.fail(req.ip); // unknown, expired and used look the same
          throw new ProblemError('invalid_pairing_token', 'This pairing code is not valid.');
        }
        const { home, away } = address(req);
        const body = {
          device_id: device.id,
          device_token: credential,
          settings: settings(device.userId),
          // Both addresses, so a phone linked at home learns the away one and the other way round.
          home_url: home,
          away_url: away,
        };
        return reply.status(201).send(body);
      },
    );

    app.get('/devices', async (req) =>
      repo.list(auth(req, 'S').userId).map((d) => view(d, skews.get(d.id))),
    );

    app.patch('/devices/:id', { schema: { params: idParams, body: renameSchema } }, async (req) => {
      const { id } = req.params as { id: number };
      const row = repo.rename(auth(req, 'S').userId, id, (req.body as { name: string }).name);
      if (!row) throw new ProblemError('not_found', 'No such device.');
      return view(row, skews.get(row.id));
    });

    app.delete('/devices/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = auth(req, 'S');
      const { id } = req.params as { id: number };
      const d = repo.find(userId, id);
      if (!d) throw new ProblemError('not_found', 'No such device.');
      if (d.revokedAt === null) repo.revoke(userId, id, now());
      return reply.status(204).send();
    });
  };
}
