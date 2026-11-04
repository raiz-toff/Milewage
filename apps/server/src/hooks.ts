import type { FastifyInstance } from 'fastify';
import { ProblemError } from './errors';
import type { ServerState } from './state';

export interface InstanceIdentity {
  instanceId: string;
  restoreGeneration: number;
}
export interface HookOptions {
  /** Requests under this path are rate limited and sent `Cache-Control: no-store`. */
  apiPrefix: string;
  now: () => number;
  version: string;
  /** The `instance` row; absent before first-run setup. */
  identity?: () => InstanceIdentity | undefined;
  /** Server mode; a restore in progress answers 503 `restoring` (10 section 7 step 2). */
  state?: ServerState;
}

/** Per-minute rate and burst for each limit class (08 section 7.4). Keys are in memory; one instance. */
export const RATE_CLASSES = {
  general: { perMinute: 300, burst: 300 },
  telemetry: { perMinute: 60, burst: 30 },
  diagnostics: { perMinute: 30, burst: 15 },
} as const;
export type RateClass = keyof typeof RATE_CLASSES;

/** Token bucket: `burst` tokens, refilled at `perMinute`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private now: () => number) {}

  take(key: string, { perMinute, burst }: { perMinute: number; burst: number }) {
    const t = this.now();
    const rate = perMinute / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: burst, at: t };
    bucket.tokens = Math.min(burst, bucket.tokens + (t - bucket.at) * rate);
    bucket.at = t;
    const ok = bucket.tokens >= 1;
    if (ok) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.prune(t);
    const seconds = (n: number) => Math.ceil(n / rate / 1000);
    return {
      ok,
      remaining: Math.floor(bucket.tokens),
      retryAfter: ok ? 0 : seconds(1 - bucket.tokens),
      reset: seconds(burst - bucket.tokens),
    };
  }

  /** Drops buckets that have refilled completely: they are the same as a new one. */
  private prune(t: number) {
    for (const [key, b] of this.buckets) if (t - b.at > 60_000 * 10) this.buckets.delete(key);
  }
}

/**
 * Hooks for every response: `X-MileWage-*` and `X-Server-Time` headers (08 sections 8 and 9),
 * `Cache-Control: no-store` on `/api`, and the per-credential rate limit with `RateLimit-*` headers.
 */
export function installHooks(fastify: FastifyInstance, o: HookOptions) {
  const limiter = new RateLimiter(o.now);
  const isApi = (url: string) => url.startsWith(`${o.apiPrefix}/`);

  fastify.addHook('onRequest', async (request, reply) => {
    if (!isApi(request.url)) return;
    if (o.state?.mode === 'restoring' && !request.url.startsWith(`${o.apiPrefix}/setup/status`)) {
      const headers = { 'Retry-After': '5' };
      throw new ProblemError('restoring', 'A restore is in progress.', undefined, headers);
    }
    const config = request.routeOptions.config as { rateLimit?: RateClass };
    const cls = config.rateLimit ?? 'general';
    const spec = RATE_CLASSES[cls];
    // The limit follows the credential, so it stays right even when client IPs are not trustworthy.
    const credential = request.headers.authorization ?? request.headers.cookie;
    const hit = limiter.take(`${cls}:${credential ?? request.ip}`, spec);
    reply
      .header('RateLimit-Limit', spec.perMinute)
      .header('RateLimit-Remaining', hit.remaining)
      .header('RateLimit-Reset', hit.reset);
    if (!hit.ok) {
      const headers = { 'Retry-After': String(hit.retryAfter) };
      throw new ProblemError('rate_limited', 'Too many requests.', undefined, headers);
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    reply
      .header('X-MileWage-Server', o.version)
      .header('X-MileWage-Api', '1')
      .header('X-Server-Time', String(o.now()));
    const id = o.identity?.();
    if (id) {
      reply
        .header('X-MileWage-Instance', id.instanceId)
        .header('X-MileWage-Restore-Gen', String(id.restoreGeneration));
    }
    if (isApi(request.url)) reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
