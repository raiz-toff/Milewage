import { useCallback } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import type { FetchResponse, MaybeOptionalInit } from 'openapi-fetch';
import type { paths } from '@milewage/shared/generated/api-types';
import { useSession } from '../session';
import { ApiError, unwrap } from './client';
import type { Api } from './client';

/**
 * Server state for the web app (plan 17 decision T8): TanStack Query over the openapi-fetch
 * client. A query's key is `[path, params]`, for example
 * `['/shifts/{ref}', { path: { ref: '7' } }]`, so a change saved to `/shifts/...` refreshes every
 * screen that shows a shift through one `invalidate('/shifts')`.
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

/** Whether a key belongs to `prefix`: the same path, or a path under it. */
export const underPath = (prefix: string) => (key: QueryKey) =>
  typeof key[0] === 'string' && (key[0] === prefix || key[0].startsWith(`${prefix}/`));

/** A 4xx answer will not change on a second try; anything else is tried once more. */
export const shouldRetry = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1;

/** The app's defaults: answers are fresh for 30 s and asked for again when the tab comes back. */
export function createQueryClient(overrides: { retry?: false; gcTime?: number } = {}) {
  return new QueryClient({
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

/** Refreshes every cached GET under each path prefix; resolves when the shown ones are back. */
export function useInvalidate() {
  const client = useQueryClient();
  return useCallback(
    (...prefixes: string[]) =>
      Promise.all(
        prefixes.map((p) =>
          client.invalidateQueries({ predicate: (q) => underPath(p)(q.queryKey) }),
        ),
      ).then(() => undefined),
    [client],
  );
}

/** Put a known answer (one a save returned) in the cache, so the screen shows it at once. */
export function useSetApiData() {
  const client = useQueryClient();
  return useCallback(
    <P extends GetPath>(path: P, params: Params<P> | undefined, data: GetData<P>) =>
      client.setQueryData(apiKey(path, params), data),
    [client],
  );
}

/**
 * A change through the typed client. After it succeeds the GETs under `invalidates` are asked
 * again, and `mutateAsync` resolves once they are back.
 */
export function useApiMutation<TVars = void, TData = unknown>(
  fn: (api: Api, vars: TVars) => Promise<TData>,
  {
    invalidates = [],
    ...options
  }: Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'> & { invalidates?: string[] } = {},
) {
  const { api } = useSession();
  const invalidate = useInvalidate();
  return useMutation<TData, Error, TVars>({
    mutationFn: (vars) => fn(api, vars),
    ...options,
    onSuccess: async (data, vars, result, context) => {
      await invalidate(...invalidates);
      await options.onSuccess?.(data, vars, result, context);
    },
  });
}
