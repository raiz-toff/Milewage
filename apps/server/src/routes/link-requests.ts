import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hashToken, newToken } from '../auth/authenticator';
import { FailureLimiter } from '../auth/limiter';
import type { DeviceRow, createDeviceRepository } from '../db';
import { ProblemError } from '../errors';
import { idParams, str, strictObject } from './util';

/**
 * Linking a phone with a code (plan 28 section 4.4), shaped like the OAuth device authorization
 * grant (RFC 8628) and Jellyfin's Quick Connect: the phone asks, shows a short `user_code`, and
 * polls with a long secret `device_code`; the driver, signed in on the web, types the code. The
 * short code is accepted only from a signed-in session, so nobody on the network can guess it.
 * Requests live in memory for 10 minutes; a restart drops them and the phone says to try again.
 */

export const LINK_TTL_MS = 10 * 60 * 1000;
/** Seconds the phone waits between polls (RFC 8628 section 3.2 `interval`). */
export const LINK_INTERVAL_S = 2;
const PER_ADDRESS = 5;
const IN_ALL = 20;

interface LinkRequest {
  id: number;
  deviceCodeHash: string;
  userCode: string;
  deviceName: string;
  platform: DeviceRow['platform'];
  from: string;
  createdAt: number;
  expiresAt: number;
  lastPollAt: number | null;
  /** After approval: the one-time pairing token the next poll redeems. */
  token: string | null;
}

const createSchema = strictObject(
  { device_name: str(1, 64), platform: { enum: ['android', 'ios'] } },
  ['device_name', 'platform'],
);
const pollSchema = strictObject({ device_code: str(1, 100) }, ['device_code']);
const approveSchema = strictObject({ user_code: str(1, 20) }, ['user_code']);

export interface LinkDeps {
  app: FastifyInstance;
  now: () => number;
  repo: ReturnType<typeof createDeviceRepository>;
  /** The signed-in web user (scope S); throws when there is none. */
  webUser: (req: FastifyRequest) => number;
  /** The redeem answer for a new device, with the addresses this request came in on. */
  redeemed: (req: FastifyRequest, device: DeviceRow, credential: string) => Record<string, unknown>;
}

export function linkRequestRoutes({ app, now, repo, webUser, redeemed }: LinkDeps) {
  const waiting = new Map<number, LinkRequest>();
  let nextId = 1;
  const wrongCodes = new FailureLimiter(10, 15 * 60 * 1000, now);

  const purge = () => {
    const t = now();
    for (const [id, r] of waiting) if (r.expiresAt <= t) waiting.delete(id);
  };
  const view = (r: LinkRequest) => ({
    id: r.id,
    device_name: r.deviceName,
    platform: r.platform,
    from: r.from,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
  });

  app.post(
    '/link-requests',
    { bodyLimit: 4096, schema: { body: createSchema } },
    async (req, reply) => {
      purge();
      const mine = [...waiting.values()].filter((r) => r.from === req.ip).length;
      if (mine >= PER_ADDRESS || waiting.size >= IN_ALL) {
        throw new ProblemError('rate_limited', 'Too many phones are waiting to link.', undefined, {
          'Retry-After': '60',
        });
      }
      const b = req.body as { device_name: string; platform: DeviceRow['platform'] };
      const taken = new Set([...waiting.values()].map((r) => r.userCode));
      let userCode: string;
      do userCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
      while (taken.has(userCode));
      const deviceCode = newToken('mwl_');
      const t = now();
      const r: LinkRequest = {
        id: nextId++,
        deviceCodeHash: hashToken(deviceCode),
        userCode,
        deviceName: b.device_name,
        platform: b.platform,
        from: req.ip,
        createdAt: t,
        expiresAt: t + LINK_TTL_MS,
        lastPollAt: null,
        token: null,
      };
      waiting.set(r.id, r);
      return reply.status(201).send({
        device_code: deviceCode,
        user_code: userCode,
        expires_in: LINK_TTL_MS / 1000,
        interval: LINK_INTERVAL_S,
      });
    },
  );

  app.post(
    '/link-requests/poll',
    { bodyLimit: 4096, schema: { body: pollSchema } },
    async (req, reply) => {
      purge();
      const hash = hashToken((req.body as { device_code: string }).device_code);
      const r = [...waiting.values()].find((x) => x.deviceCodeHash === hash);
      if (!r) {
        throw new ProblemError(
          'link_expired',
          'This link request expired, was refused or was used.',
        );
      }
      const t = now();
      // RFC 8628 section 3.5 `slow_down`: a little slack for timers that fire early.
      if (r.lastPollAt !== null && t - r.lastPollAt < LINK_INTERVAL_S * 1000 - 250) {
        throw new ProblemError('slow_down', 'Polling too fast.', undefined, {
          'Retry-After': String(LINK_INTERVAL_S),
        });
      }
      r.lastPollAt = t;
      if (!r.token) return reply.status(202).send({ status: 'pending' });
      waiting.delete(r.id); // single use, whatever happens next
      const credential = newToken('mwd_');
      const device = repo.redeem(hashToken(r.token), t, {
        name: r.deviceName,
        platform: r.platform,
        tokenHash: hashToken(credential),
      });
      if (!device) throw new ProblemError('link_expired', 'This link request expired.');
      return reply.status(201).send(redeemed(req, device, credential));
    },
  );

  app.get('/link-requests', async (req) => {
    webUser(req);
    purge();
    return [...waiting.values()].filter((r) => !r.token).map(view);
  });

  app.post(
    '/link-requests/approve',
    { bodyLimit: 4096, schema: { body: approveSchema } },
    async (req) => {
      const userId = webUser(req);
      const key = `user:${userId}`;
      const wait = wrongCodes.retryAfter(key);
      if (wait > 0) {
        throw new ProblemError('rate_limited', 'Too many wrong codes.', undefined, {
          'Retry-After': String(wait),
        });
      }
      purge();
      const code = (req.body as { user_code: string }).user_code.replace(/[\s-]/g, '');
      const r = [...waiting.values()].find((x) => !x.token && x.userCode === code);
      if (!r) {
        wrongCodes.fail(key);
        throw new ProblemError(
          'invalid_link_code',
          'That code does not match a phone waiting to link. Check the code on the phone.',
        );
      }
      const token = newToken('mwp_');
      repo.addPairingToken({
        userId,
        tokenHash: hashToken(token),
        createdAt: now(),
        expiresAt: r.expiresAt,
      });
      r.token = token;
      return { id: r.id, device_name: r.deviceName };
    },
  );

  app.delete('/link-requests/:id', { schema: { params: idParams } }, async (req, reply) => {
    webUser(req);
    waiting.delete((req.params as { id: number }).id);
    return reply.status(204).send();
  });
}
