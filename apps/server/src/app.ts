import Fastify, { type FastifyInstance } from 'fastify';
import {
  buildRegistry,
  createEventBus,
  type EnabledMap,
  type EventBus,
  type ModuleDefinition,
  type ModuleRegistry,
  type RouteHost,
} from '@milewage/shared';
import { gunzipRequest } from './gzip';
import { installHooks, type InstanceIdentity } from './hooks';
import { SERVER_VERSION } from './version';
import type { ServerState } from './state';
import { newRequestId, ProblemError, sendProblem, toProblem } from './errors';

export const API_PREFIX = '/api/v1';

/** The host modules see: RouteHost plus the Fastify scope, for routes that need replies, cookies or schemas. */
export interface ServerRouteHost extends RouteHost {
  readonly app: FastifyInstance;
  readonly registry: ModuleRegistry;
}

export interface AppOptions {
  modules: readonly ModuleDefinition[];
  enabled: EnabledMap;
  logLevel?: string;
  logStream?: { write(line: string): void };
  /** GET /healthz probe; the database check is added with the DB layer. */
  isHealthy?: () => boolean;
  /** The `instance` row, sent as `X-MileWage-Instance` and `-Restore-Gen`. */
  identity?: () => InstanceIdentity | undefined;
  /** Clock for rate limits and `X-Server-Time`. */
  now?: () => number;
  /** Addresses (or CIDRs) of the reverse proxy whose `X-Forwarded-For` is believed; off by default. */
  trustProxy?: boolean | string[];
  /** Mode of the server; defaults to always normal. */
  state?: ServerState;
}

export interface App {
  fastify: FastifyInstance;
  registry: ModuleRegistry;
  bus: EventBus;
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.current_password',
  '*.new_password',
  '*.recovery_key',
];

/** Builds the Fastify app. Throws ModuleConfigError for an invalid module configuration. */
export function buildApp(options: AppOptions): App {
  const registry = buildRegistry(options.modules, options.enabled);
  const fastify = Fastify({
    genReqId: () => newRequestId(),
    bodyLimit: 64 * 1024,
    trustProxy: options.trustProxy ?? false,
    // Unknown request fields are rejected with 422, not silently stripped (08 section 1).
    ajv: { customOptions: { removeAdditional: false } },
    logger: {
      level: options.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  });
  const bus = createEventBus();

  installHooks(fastify, {
    apiPrefix: API_PREFIX,
    now: options.now ?? Date.now,
    version: SERVER_VERSION,
    identity: options.identity,
    state: options.state,
  });
  fastify.addHook('preParsing', gunzipRequest);
  fastify.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error as never);
    if (problem.status >= 500) request.log.error({ err: error }, 'request failed');
    return sendProblem(reply, request, problem);
  });
  fastify.setNotFoundHandler((request, reply) =>
    sendProblem(reply, request, new ProblemError('not_found', 'No such route.')),
  );

  fastify.get('/healthz', async (_request, reply) => {
    const ok = options.isHealthy?.() ?? true;
    return ok ? { ok: true } : reply.status(503).send({ ok: false });
  });

  // Module routes live under /api/v1; a disabled module registers nothing, so its paths 404.
  void fastify.register(
    async (api) => {
      const host: ServerRouteHost = {
        app: api,
        registry,
        route(method, path, handler) {
          api.route({
            method: method as never,
            url: path,
            handler: async (request) => handler(request),
          });
        },
      };
      registry.registerRoutes(host);
    },
    { prefix: API_PREFIX },
  );
  registry.attachSubscriptions(bus);
  const stopJobs = registry.startJobs();
  fastify.addHook('onClose', () => stopJobs());
  return { fastify, registry, bus };
}
