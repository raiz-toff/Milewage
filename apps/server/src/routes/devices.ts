import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import { hashToken, newToken, type Authenticator } from '../auth/authenticator';
import { FailureLimiter } from '../auth/limiter';
import { createDeviceRepository, type Db, type DeviceRow } from '../db';
import { ProblemError } from '../errors';
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
const view = (d: DeviceRow) => ({
  id: d.id,
  name: d.name,
  platform: d.platform,
  created_at: d.createdAt,
  last_seen_at: d.lastSeenAt,
  revoked_at: d.revokedAt,
});

export interface DevicesContext {
  db: Db;
  now: () => number;
  authn: Authenticator;
  /** Core service: the `Settings` response, returned to a phone when it pairs. */
  readSettings: (host: ServerRouteHost) => (userId: number) => object;
}

/** Pairing, device credentials and the device list (08 section 2.4). */
export function devicesRoutes({ db, now, authn, readSettings }: DevicesContext) {
  return (routeHost: RouteHost) => {
    const host = routeHost as ServerRouteHost;
    const { app } = host;
    const auth = authn.authenticate;
    const repo = createDeviceRepository(db);
    const limiter = new FailureLimiter(10, 15 * 60 * 1000, now);
    const settings = readSettings(host);

    authn.useDeviceBranch((tokenHash) => {
      const d = repo.findByTokenHash(tokenHash);
      if (!d) throw new ProblemError('auth_required', 'Unknown credential.');
      if (d.revokedAt !== null) throw new ProblemError('device_revoked', 'This phone was revoked.');
      const t = now();
      if (d.lastSeenAt === null || t - d.lastSeenAt >= 60_000) repo.seen(d.id, t); // at most once a minute
      return { kind: 'device', userId: d.userId, deviceId: d.id };
    });

    app.post('/pairing-tokens', async (req, reply) => {
      const { userId } = auth(req, 'S');
      const token = newToken('mwp_');
      const createdAt = now();
      const expiresAt = createdAt + 10 * 60 * 1000;
      repo.addPairingToken({ userId, tokenHash: hashToken(token), createdAt, expiresAt });
      const proto = first(req.headers['x-forwarded-proto']) ?? 'http';
      const base = `${proto}://${first(req.headers['x-forwarded-host']) ?? req.headers.host}`;
      const qr = `milewage://pair?v=1&u=${encodeURIComponent(base)}&t=${token}`;
      return reply.status(201).send({ token, expires_at: expiresAt, qr_payload: qr });
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
        const body = {
          device_id: device.id,
          device_token: credential,
          settings: settings(device.userId),
        };
        return reply.status(201).send(body);
      },
    );

    app.get('/devices', async (req) => repo.list(auth(req, 'S').userId).map(view));

    app.patch('/devices/:id', { schema: { params: idParams, body: renameSchema } }, async (req) => {
      const { id } = req.params as { id: number };
      const row = repo.rename(auth(req, 'S').userId, id, (req.body as { name: string }).name);
      if (!row) throw new ProblemError('not_found', 'No such device.');
      return view(row);
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
