import createClient from 'openapi-fetch';
import type { components, paths } from '@milewage/shared/generated/api-types';

/** Types come from the OpenAPI document (17 T6); nothing here is written by hand twice. */
export type Schemas = components['schemas'];
export type Settings = Schemas['Settings'];
export type Modules = Schemas['Modules'];
export type Api = ReturnType<typeof createApi>;

/** The server's session cookie is same-origin, so the client sends it and nothing else. */
export function createApi(fetchImpl?: typeof fetch) {
  return createClient<paths>({
    baseUrl: `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`,
    credentials: 'same-origin',
    ...(fetchImpl ? { fetch: (req: Request) => fetchImpl(req) } : {}),
  });
}

/**
 * The request options that send a file as the raw body with its own content type (a receipt),
 * instead of as JSON. The routes declare a binary body, which the generated types
 * cannot express for a `File`, hence the casts.
 */
export const fileBody = (file: File) =>
  ({
    body: file as never,
    bodySerializer: (b: unknown) => b as never,
    headers: { 'Content-Type': file.type },
  }) as const;

/** An error response (RFC 9457 problem document, 08 section 7.1) or a transport failure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { path: string; message: string }[] = [],
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(response: Response, body: unknown): ApiError {
    const p = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const retry = Number(response.headers.get('Retry-After'));
    return new ApiError(
      response.status,
      typeof p.code === 'string' ? p.code : 'unknown',
      typeof p.detail === 'string'
        ? p.detail
        : typeof p.title === 'string'
          ? p.title
          : 'Request failed',
      Array.isArray(p.errors) ? (p.errors as ApiError['fields']) : [],
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
}

/** Resolves with the body, or throws ApiError for any non-2xx answer. */
export async function unwrap<T>(
  pending: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const r = await pending;
  if (!r.response.ok) throw ApiError.from(r.response, r.error);
  return r.data as T;
}

/** Text for a form: the first field error if there is one, else the problem's own detail. */
export function describe(error: unknown): string {
  if (error instanceof ApiError) {
    const wait = error.retryAfter ? ` Try again in ${error.retryAfter} s.` : '';
    return (
      (error.fields[0] ? `${error.fields[0].path}: ${error.fields[0].message}` : error.message) +
      wait
    );
  }
  return 'The server could not be reached.';
}
