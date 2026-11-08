import { randomBytes } from 'node:crypto';
import { countryModules, type ModuleRegistry, type RouteHost } from '@milewage/shared';
import { API_PREFIX, type ServerRouteHost } from '../app';
import { generateRecoveryKey, keyTail, tailCheck } from '../backup/age';
import { fileSecrets, type SecretsStore } from '../backup/secrets';
import { FailureLimiter } from '../auth/limiter';
import { hashPassword, verifyPassword } from '../auth/password';
import type { Authenticator } from '../auth/authenticator';
import { clearCookie, secureRequest, startSession } from '../auth/sessions';
import {
  confirmSetup,
  createInstanceReader,
  createSessionRepository,
  createUserRepository,
  type Db,
} from '../db';
import { COMMA_DEFAULTS, type CommaOptions } from '../comma-options';
import { countriesRoute } from './countries';
import { describeError, ProblemError } from '../errors';
import { settingsRoutes } from './settings';
import { statusRoute, type StatusContext } from './status';
import type { ShiftProcessor } from '../processing/shift-processor';
import { odometerRoutes } from './odometer';
import { shiftRoutes } from './shifts';
import { createEarningsPolicy } from './earnings';
import { summaryRoute } from './summary';
import { tripRoutes } from './trips';
import { vehicleRoutes } from './vehicles';

export interface CoreContext {
  db: Db;
  now: () => number;
  /** Countries a driver may choose; defaults to every registered country (plan 21). */
  countries?: readonly string[];
  /** `config/secrets.json`; defaults to the `config` directory. */
  secrets?: SecretsStore;
  /** Inputs of `GET /system/status`; each is optional so a bare core still serves it. */
  status?: Pick<StatusContext, 'state' | 'disk' | 'lastBackup' | 'diagnostics'>;
  /** `backup.download` (10 section 3.1); reported to clients as `modules.backup_download`. */
  backupDownload?: boolean;
  exportFormats?: (reg: ModuleRegistry) => string[];
  /** The active capture session of a device, for `diagnostics.capture` in `GET /settings`. */
  captureFor?: (userId: number, deviceId: number) => object | null;
  /** The owner's answers to the open questions of 18 section 16 (defaults in `comma-options.ts`). */
  comma?: Partial<CommaOptions>;
  /** The engine run at shift end (tracking module); absent in a bare core. */
  processor?: ShiftProcessor;
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
  {
    db,
    now,
    countries = countryModules.codes(),
    secrets = fileSecrets('config'),
    status,
    processor,
    backupDownload,
    exportFormats,
    captureFor,
    comma,
  }: CoreContext,
  authn: Authenticator,
) {
  return (host: RouteHost) => {
    const { app, registry } = host as ServerRouteHost;
    const users = createUserRepository(db);
    const sessions = createSessionRepository(db);
    const limiter = new FailureLimiter(5, 15 * 60 * 1000, now);
    const dummy = hashPassword('no-such-user');
    const auth = authn.authenticate;
    const emit = (host as ServerRouteHost).bus.emit;
    settingsRoutes(app, {
      db,
      now,
      auth,
      registry,
      countries,
      emit,
      backupDownload: backupDownload !== false,
      exportFormats,
      captureFor,
    });
    countriesRoute(app, {
      countries,
      taxShown: comma?.taxCountries ?? COMMA_DEFAULTS.taxCountries,
    });
    vehicleRoutes(app, { db, now, auth, emit });
    odometerRoutes(app, { db, now, auth, emit });
    summaryRoute(app, {
      db,
      now,
      auth,
      earnings: createEarningsPolicy(db, registry, comma?.earningsOverride),
    });
    statusRoute(app, { db, now, auth, registry, ...status });
    shiftRoutes(app, {
      db,
      now,
      auth,
      processor,
      emit,
      trackingOn: () => registry.isEnabled('tracking'),
      stopsOn: () => registry.isEnabled('stops'),
    });

    if (processor) {
      tripRoutes(app, {
        db,
        now,
        auth,
        processor,
        emit,
        trackingOn: () => registry.isEnabled('tracking'),
      });
    }

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
      '/countries',
      '/auth/login',
      '/auth/logout',
    ].map((p) => API_PREFIX + p);
    let confirmed = false;
    app.addHook('onRequest', async (request) => {
      if (confirmed) return;
      const state = setupState();
      if (state === 'ready') confirmed = true;
      if (state !== 'needs_confirmation') return;
      const path = request.url.split('?')[0]!;
      if (!openBeforeConfirm.includes(path) && !path.startsWith(`${API_PREFIX}/errors/`)) {
        throw new ProblemError('setup_incomplete', 'Confirm the recovery key to finish setup.');
      }
    });

    app.get('/setup/status', async () => ({ state: setupState() }));

    // Public: the `type` URI of every problem points here (RFC 9457).
    app.get('/errors/:code', async (request) => {
      const found = describeError((request.params as { code: string }).code);
      if (!found) throw new ProblemError('not_found', 'There is no error with this code.');
      return found;
    });

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
      const cookie = startSession(sessions, user.id, now(), secureRequest(request));
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
        .header('set-cookie', startSession(sessions, user.id, now(), secureRequest(request)))
        .send();
    });

    app.post('/auth/logout', async (request, reply) => {
      sessions.delete(auth(request, 'S').idHash);
      return reply
        .status(204)
        .header('set-cookie', clearCookie(secureRequest(request)))
        .send();
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
