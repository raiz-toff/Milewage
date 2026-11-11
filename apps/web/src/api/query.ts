import { useCallback, useState } from 'react';
import { MutationCache, QueryClient, hashKey, useMutation, useQuery } from '@tanstack/react-query';
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import type { FetchResponse, MaybeOptionalInit } from 'openapi-fetch';
import type { paths } from '@milewage/shared/generated/api-types';
import { useSession } from '../session';
import { ApiError, describe, unwrap } from './client';
import type { Api } from './client';

/**
 * Server state for the web app (plan 17 decision T8): TanStack Query over the openapi-fetch
 * client. Reads go through `useApiQuery`; a query's key is `[path, params]`, for example
 * `['/shifts/{ref}', { path: { ref: '7' } }]`. Every write goes through `useChange`, and after a
 * write succeeds every cached read is out of date (see `afterChange`).
 */

export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never;
}[keyof paths];
export type GetInit<P extends GetPath> = MaybeOptionalInit<paths[P], 'get'>;
export type GetData<P extends GetPath> = NonNullable<
  FetchResponse<paths[P]['get'], GetInit<P>, `${string}/${string}`>['data']
>;
type Params<P extends GetPath> = NonNullable<GetInit<P>> extends { params?: infer X } ? X : never;

/** The cache key of a GET: its path template and its parameters. */
export const apiKey = <P extends GetPath>(path: P, params?: Params<P>): QueryKey => [
  path,
  params ?? {},
];

/** A 4xx answer will not change on a second try; anything else is tried once more. */
export const shouldRetry = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1;

/** A known answer for one cached read: a save that answers with the new record (`put`). */
export type Put = readonly [key: QueryKey, value: unknown];

/** The variables of every change: the request, and the reads its answer already updates. */
interface Sent {
  send: (api: Api) => Promise<Answer<unknown>>;
  puts?: (data: unknown) => readonly Put[];
}

/**
 * The effects policy of a change that succeeded. The server derives most figures from several
 * records (an expense moves the tax estimate and a vehicle's tax year; an earning
 * moves tax; settings move nearly everything), so the web does not keep a
 * list of which read depends on which write: every cached read is invalidated. Shown reads are
 * read again before the change resolves; the rest are read when next shown. The reads the answer
 * itself updates (`puts`) are set from it and not asked again.
 */
async function afterChange(client: QueryClient, data: unknown, sent: Sent | undefined) {
  const puts = sent?.puts?.(data) ?? [];
  for (const [key, value] of puts) client.setQueryData(key, value);
  const kept = new Set(puts.map(([key]) => hashKey(key)));
  await client.invalidateQueries({ predicate: (q) => !kept.has(q.queryHash) });
}

/** The app's defaults: answers are fresh for 30 s and asked for again when the tab comes back. */
export function createQueryClient(overrides: { retry?: false; gcTime?: number } = {}) {
  // TanStack Query's "automatic query invalidation after mutations": one MutationCache handler.
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (data, variables) => afterChange(client, data, variables as Sent | undefined),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: overrides.retry ?? shouldRetry,
        ...(overrides.gcTime !== undefined ? { gcTime: overrides.gcTime } : {}),
      },
      mutations: { retry: false },
    },
  });
  return client;
}

type QueryOptions<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>;

/**
 * GET `path` through the typed client. The request is cancelled when the key changes or the
 * screen goes, and an answer only ever lands under its own key, so a slow earlier answer
 * cannot replace a newer one.
 */
export function useApiQuery<P extends GetPath>(
  path: P,
  init?: GetInit<P>,
  options: QueryOptions<GetData<P>> = {},
) {
  const { api } = useSession();
  const params = (init as { params?: Params<P> } | undefined)?.params;
  return useQuery<GetData<P>, Error, GetData<P>>({
    queryKey: apiKey(path, params),
    queryFn: ({ signal }) =>
      unwrap<GetData<P>>(
        (api.GET as (p: string, i: object) => Promise<never>)(path, { ...init, signal }),
      ),
    ...options,
  });
}

/**
 * A read's new value, known from a change's answer: `put('/shifts/{ref}', params, shift)`, or a
 * function of the cached value (`(old) => …`).
 */
export const put = <P extends GetPath>(
  path: P,
  params: Params<P> | undefined,
  value: GetData<P> | ((old: GetData<P> | undefined) => GetData<P> | undefined),
): Put => [apiKey(path, params), value];

/** A write's answer as the typed client gives it. */
type Answer<T> = { data?: T; error?: unknown; response: Response };

/** What a page writes with; see `useChange`. */
export interface Change {
  /**
   * Send one change (`(api) => api.POST(…)`). Resolves with `{ data }` (the server's answer) once
   * the shown reads are fresh again, or with null when it failed; then `error` says why.
   * `puts` names the reads the answer itself updates (`put(…)`).
   */
  run: <T>(
    send: (api: Api) => Promise<Answer<T>>,
    puts?: (data: T) => readonly Put[],
  ) => Promise<{ data: T } | null>;
  /** True while a change is on its way. */
  busy: boolean;
  /** The sentence for the driver: the server's problem detail, or a page's own check. */
  error: string | null;
  /** Show a page's own check on the same line (null clears it); nothing is sent. */
  setError: (message: string | null) => void;
}

/**
 * The one write path of the web app. A page names only the request; behind it are `unwrap`,
 * the problem detail as one sentence (`describe`), the busy flag, putting a known answer in the
 * cache and the effects policy (`afterChange`). It never throws: a failure is `error`.
 */
export function useChange(): Change {
  const { api } = useSession();
  const [own, setOwn] = useState<string | null>(null);
  const mutation = useMutation<unknown, Error, Sent>({
    mutationFn: ({ send }) => unwrap(send(api)),
  });
  const { mutateAsync, reset } = mutation;
  // Both stay the same function from render to render, so an effect may depend on them.
  const run = useCallback<Change['run']>(
    async (send, puts) => {
      setOwn(null);
      try {
        const data = await mutateAsync({ send, puts } as Sent);
        return { data: data as never };
      } catch {
        return null;
      }
    },
    [mutateAsync],
  );
  const setError = useCallback(
    (message: string | null) => {
      if (message === null) reset();
      setOwn(message);
    },
    [reset],
  );
  return {
    run,
    busy: mutation.isPending,
    error: own ?? (mutation.error ? describe(mutation.error) : null),
    setError,
  };
}

/** The page's one error line: the first of a change's error and the reads' failures. */
export function errorText(...sources: { error: unknown }[]): string | null {
  const failed = sources.find((s) => s.error);
  if (!failed) return null;
  return typeof failed.error === 'string' ? failed.error : describe(failed.error);
}
