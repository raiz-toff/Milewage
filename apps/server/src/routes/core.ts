import { randomBytes } from 'node:crypto';
import type { RouteHost } from '@milewage/shared';
import { API_PREFIX, type ServerRouteHost } from '../app';
import { generateRecoveryKey, keyTail, tailCheck } from '../backup/age';
import { fileSecrets, type SecretsStore } from '../backup/secrets';
import { FailureLimiter } from '../auth/limiter';
import { hashPassword, verifyPassword } from '../auth/password';
import type { Authenticator } from '../auth/authenticator';
import { clearCookie, startSession } from '../auth/sessions';
import {
  confirmSetup,
  createInstanceReader,
  createSessionRepository,
  createUserRepository,
  type Db,
} from '../db';
import { ProblemError } from '../errors';
import { DEFAULT_COUNTRIES, settingsRoutes } from './settings';
import { shiftRoutes } from './shifts';
import { vehicleRoutes } from './vehicles';

export interface CoreContext {
  db: Db;
  now: () => number;
  /** Registered country packs (config `countries`); defaults to US, CA, GB. */
  countries?: readonly string[];
  /** `config/secrets.json`; defaults to the `config` directory. */
  secrets?: SecretsStore;
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
const confirmBody = body({ last6: str(6, 6) });
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
  { db, now, countries = DEFAULT_COUNTRIES, secrets = fileSecrets('config') }: CoreContext,
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

    const instanceRow = createInstanceReader(db);
    const setupState = () => {
      const row = instanceRow();
      if (!row) return 'needs_setup' as const;
      return row.setupConfirmedAt === null ? ('needs_confirmation' as const) : ('ready' as const);
    };

    // Until the recovery key is confirmed only these routes answer (08 section 2.3). Login is added
    // to the spec's list: a driver who signed out before confirming must be able to sign back in.
    const openBeforeConfirm = [
      '/setup',
      '/setup/status',
      '/setup/confirm',
      '/setup/restore',
      '/auth/login',
      '/auth/logout',
    ].map((p) => API_PREFIX + p);
    let confirmed = false;
    app.addHook('onRequest', async (request) => {
      if (confirmed) return;
      const state = setupState();
      if (state === 'ready') confirmed = true;
      if (state !== 'needs_confirmation') return;
      if (!openBeforeConfirm.includes(request.url.split('?')[0]!)) {
        throw new ProblemError('setup_incomplete', 'Confirm the recovery key to finish setup.');
      }
    });

    app.get('/setup/status', async () => ({ state: setupState() }));

    app.post('/setup', setupBody, async (request, reply) => {
      const b = request.body as SetupBody;
      const key = await generateRecoveryKey();
      const passwordHash = await hashPassword(b.password);
      // No await from here on, so two concurrent setups cannot interleave the file and the row.
      const user = users.createOwner(
        { username: b.username, passwordHash, createdAt: now() },
        {
          country: b.country.toUpperCase(),
          distanceUnit: b.distance_unit,
          currency: b.currency.toUpperCase(),
          timezone: b.timezone,
        },
        randomBytes(16).toString('hex'),
      );
      // Only the public key is kept; the private key goes to the driver in this one response.
      secrets.write({
        age_public_key: key.recipient,
        key_tail_check: tailCheck(keyTail(key.identity)),
      });
      const cookie = startSession(sessions, user.id, now());
      return reply
        .status(201)
        .header('set-cookie', cookie)
        .send({ recovery_key: key.identity, state: 'needs_confirmation' });
    });

    app.post('/setup/confirm', confirmBody, async (request) => {
      auth(request, 'S');
      if (setupState() === 'ready') return { state: 'ready' };
      const current = secrets.read();
      const last6 = (request.body as { last6: string }).last6;
      if (!current?.key_tail_check || tailCheck(last6) !== current.key_tail_check) {
        throw new ProblemError('validation_failed', 'That is not the end of the recovery key.', [
          { path: '/last6', message: 'does not match the last 6 characters of the recovery key' },
        ]);
      }
      confirmSetup(db, now());
      secrets.write({ age_public_key: current.age_public_key }); // the check is no longer needed
      return { state: 'ready' };
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
