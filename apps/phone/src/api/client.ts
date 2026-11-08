import { httpAllowed } from '@milewage/shared';

/**
 * Thin JSON client for `/api/v1` (08). `fetch` and the clock are injected so tests use a mock
 * server. It never logs: tokens and bodies stay out of every message it builds.
 */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The Problem `code`, or `network` / `bad_response` when there was no usable answer. */
    readonly code: string,
    readonly retryable: boolean,
    /** Seconds from `Retry-After`, when the server sent one. */
    readonly retryAfterS: number | null = null,
    readonly body: unknown = null,
  ) {
    super(`${status} ${code}`);
    this.name = 'MilewageApiError';
  }
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface ApiClientOptions {
  /** The server, or how to pick one per request (home or away, plan 28). */
  baseUrl: string | (() => Promise<string>);
  /**
   * Plain http to any address (debug builds only). Otherwise http goes only to a home address
   * (plan 28 section 4.1): the app allows cleartext at the platform level, and this is the gate.
   */
  anyHttp?: boolean;
  /** Called when a request got no answer at all (the home/away choice is looked at again). */
  onUnreachable?: () => void;
  fetch: FetchFn;
  now?: () => number;
  /** Device bearer token. Omitted for the unauthenticated redeem call. */
  token?: string | null;
  /** True stops every request before it is sent (a wrong server was detected, 15 section 9.4). */
  blocked?: () => boolean;
  /** Sees the headers of every answer, ok or not. */
  onResponse?: (headers: Headers) => void;
  /** Sees every refusal before it is thrown (the pairing notices a revoked phone here). */
  onProblem?: (e: ApiError) => void;
}

export class ApiClient {
  private readonly now: () => number;

  constructor(private readonly opts: ApiClientOptions) {
    this.now = opts.now ?? Date.now;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    rawBody?: Uint8Array,
  ): Promise<ApiResponse<T>> {
    // Retryable on purpose: queued data is kept and retried, nothing is sent while blocked.
    if (this.opts.blocked?.()) throw new ApiError(0, 'wrong_server', true);
    const base =
      typeof this.opts.baseUrl === 'string' ? this.opts.baseUrl : await this.opts.baseUrl();
    // Never sent: plain http outside the home network (owner decision 2026-11-08).
    if (!this.opts.anyHttp && !httpAllowed(base)) throw new ApiError(0, 'insecure_address', false);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Client-Time': String(this.now()),
      ...extraHeaders,
    };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    let payload: BodyInit | undefined;
    if (rawBody) {
      payload = rawBody as unknown as BodyInit;
      headers['Content-Type'] = 'application/json';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    let res: Response;
    try {
      res = await this.opts.fetch(`${base}/api/v1${path}`, {
        method,
        headers,
        body: payload,
      });
    } catch {
      this.opts.onUnreachable?.();
      throw new ApiError(0, 'network', true);
    }
    this.opts.onResponse?.(res.headers);
    const text = await res.text();
    let json: unknown = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new ApiError(res.status, 'bad_response', false);
      }
    }
    if (!res.ok) {
      const p = (json ?? {}) as { code?: unknown; retryable?: unknown };
      const retryAfter = Number(res.headers.get('Retry-After'));
      const e = new ApiError(
        res.status,
        typeof p.code === 'string' ? p.code : 'unknown',
        typeof p.retryable === 'boolean' ? p.retryable : res.status >= 500 || res.status === 429,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        json,
      );
      this.opts.onProblem?.(e);
      throw e;
    }
    return { status: res.status, data: json as T, headers: res.headers };
  }
}
