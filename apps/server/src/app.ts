import Fastify, { type FastifyInstance } from 'fastify';
import type { EventBus, ModuleRegistry } from '@milewage/shared';
import { gunzipRequest } from './gzip';
import { installHooks, type InstanceIdentity } from './hooks';
import { SERVER_VERSION } from './version';
import type { DiskState } from './disk';
import type { ServerState } from './state';
import { newRequestId, ProblemError, sendProblem, toProblem } from './errors';

export const API_PREFIX = '/api/v1';

/** What a module's routes are registered on: the `/api/v1` Fastify scope, the module registry and the event bus. */
export interface ServerRouteHost {
  readonly app: FastifyInstance;
  /**
   * The unprefixed root, only for documents a standard places at the origin: the OAuth discovery
   * documents under `/.well-known/` (RFC 8414, RFC 9728). Everything else goes on `app`.
   */
  readonly root: FastifyInstance;
  readonly registry: ModuleRegistry;
  /** The in-process event bus (08 section 16.4); modules emit facts, other modules subscribe. */
  readonly bus: EventBus;
}

/** The HTTP side of the server: everything but the modules. */
export interface HttpOptions {
  logLevel?: string;
  logStream?: { write(line: string): void };
  /** GET /healthz probe. */
  isHealthy?: () => boolean;
  /** The `instance` row, sent as `X-MileWage-Instance` and `-Restore-Gen`. */
  identity?: () => InstanceIdentity | undefined;
  /** Clock for rate limits and `X-Server-Time`. */
  now?: () => number;
  /** Addresses (or CIDRs) of the reverse proxy whose `X-Forwarded-For` is believed; off by default. */
  trustProxy?: boolean | string[];
  /** Mode of the server; defaults to always normal. */
  state?: ServerState;
  /** Free-space rules; omitted means plenty of room. */
  disk?: () => DiskState;
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

/**
 * Builds the Fastify instance: hooks, the error model, `/healthz` and the `/api/v1` scope, in which
 * `mount` registers the module routes when the instance loads. The server's only caller is
 * `assembleServer`.
 */
export function buildHttpApp(
  options: HttpOptions,
  mount: (api: FastifyInstance, root: FastifyInstance) => void,
): FastifyInstance {
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
  installHooks(fastify, {
    apiPrefix: API_PREFIX,
    now: options.now ?? Date.now,
    version: SERVER_VERSION,
    identity: options.identity,
    state: options.state,
    disk: options.disk,
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
  void fastify.register(async (api) => mount(api, fastify), { prefix: API_PREFIX });
  return fastify;
}
