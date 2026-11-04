import { randomBytes } from 'node:crypto';
import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import { FailureLimiter } from '../auth/limiter';
import { hashPassword, verifyPassword } from '../auth/password';
import type { Authenticator } from '../auth/authenticator';
import { clearCookie, startSession } from '../auth/sessions';
import { createSessionRepository, createUserRepository, type Db } from '../db';
import { ProblemError } from '../errors';
import { DEFAULT_COUNTRIES, settingsRoutes } from './settings';
import { shiftRoutes } from './shifts';
import { vehicleRoutes } from './vehicles';

export interface CoreContext {
  db: Db;
  now: () => number;
  /** Registered country packs (config `countries`); defaults to US, CA, GB. */
  countries?: readonly string[];
}

const str = (min: number, max = 1024) => ({ type: 'string', minLength: min, maxLength: max });
const body = (properties: Record<string, object>) => ({
  schema: {
    body: {
      type: 'object',
      required: Object.keys(properties),
      additionalProperties: false,
      properties,
    },
  },
});
const setupBody = body({
  username: str(3, 64),
  password: str(10),
  country: str(2, 2),
  distance_unit: { enum: ['km', 'mi'] },
  currency: str(3, 3),
  timezone: str(1, 64), // IANA name; checked against the zone database when GET/PUT /settings arrives
});
const loginBody = body({ username: str(1, 64), password: str(1) });
const passwordBody = body({ current_password: str(1), new_password: str(10) });

interface SetupBody {
  username: string;
  password: string;
  country: string;
  distance_unit: 'km' | 'mi';
  currency: string;
  timezone: string;
}

export function coreRoutes(
  { db, now, countries = DEFAULT_COUNTRIES }: CoreContext,
  authn: Authenticator,
) {
  return (host: RouteHost) => {
    const { app, registry } = host as ServerRouteHost;
    const users = createUserRepository(db);
    const sessions = createSessionRepository(db);
    const limiter = new FailureLimiter(5, 15 * 60 * 1000, now);
    const dummy = hashPassword('no-such-user');
    const auth = authn.authenticate;
    settingsRoutes(app, { db, now, auth, registry, countries });
    vehicleRoutes(app, { db, now, auth });
    shiftRoutes(app, { db, now, auth });

    app.get('/setup/status', async () => ({ state: users.count() ? 'ready' : 'needs_setup' }));

    app.post('/setup', setupBody, async (request, reply) => {
      const b = request.body as SetupBody;
      const user = users.createOwner(
        { username: b.username, passwordHash: await hashPassword(b.password), createdAt: now() },
        {
          country: b.country.toUpperCase(),
          distanceUnit: b.distance_unit,
          currency: b.currency.toUpperCase(),
          timezone: b.timezone,
        },
        randomBytes(16).toString('hex'),
      );
      const cookie = startSession(sessions, user.id, now());
      return reply.status(201).header('set-cookie', cookie).send({ state: 'ready' });
    });

    app.post('/auth/login', loginBody, async (request, reply) => {
      const b = request.body as { username: string; password: string };
      const keys = [`ip:${request.ip}`, `account:${b.username.toLowerCase()}`] as const;
      const wait = Math.max(...keys.map((k) => limiter.retryAfter(k)));
      if (wait > 0) {
        const headers = { 'Retry-After': String(wait) };
        throw new ProblemError('rate_limited', 'Too many failed sign-ins.', undefined, headers);
      }
      const user = users.findByUsername(b.username);
      const ok = await verifyPassword(b.password, user?.passwordHash ?? (await dummy));
      if (!user || !ok) {
        keys.forEach(limiter.fail);
        throw new ProblemError('invalid_credentials', 'Wrong username or password.');
      }
      limiter.reset(keys[1]);
      return reply
        .status(204)
        .header('set-cookie', startSession(sessions, user.id, now()))
        .send();
    });

    app.post('/auth/logout', async (request, reply) => {
      sessions.delete(auth(request, 'S').idHash);
      return reply.status(204).header('set-cookie', clearCookie()).send();
    });

    app.post('/auth/password', passwordBody, async (request, reply) => {
      const me = auth(request, 'S');
      const b = request.body as { current_password: string; new_password: string };
      const user = users.findById(me.userId);
      if (!user || !(await verifyPassword(b.current_password, user.passwordHash))) {
        throw new ProblemError('invalid_credentials', 'The current password is wrong.');
      }
      users.setPasswordHash(user.id, await hashPassword(b.new_password));
      sessions.deleteOthers(user.id, me.idHash);
      return reply.status(204).send();
    });
  };
}
