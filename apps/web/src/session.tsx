import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import { apiKey, put } from './api/query';
import { ApiError, createApi, unwrap } from './api/client';
import type { Api, Schemas, Settings } from './api/client';

/** What the shell knows about the visitor. `ready` carries the settings and module flags. */
export type SessionState =
  | { status: 'loading' }
  | { status: 'needs_setup' }
  | { status: 'needs_confirmation' }
  | { status: 'signed_out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; settings: Settings };

interface SessionValue {
  api: Api;
  state: SessionState;
  /** Ask the server again (after setup, login, or a restore). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Context = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(Context);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}

/** Settings of a signed-in visitor; only call below a screen that is rendered when `ready`. */
export function useSettings(): Settings {
  const { state } = useSession();
  if (state.status !== 'ready') throw new Error('useSettings outside a signed-in screen');
  return state.settings;
}

/**
 * The settings are server state like any other answer: they live in the query cache under the
 * key of `GET /settings`. The cache keeps them for the whole session (`gcTime: Infinity`);
 * signing out clears it.
 */
const settingsQuery = (api: Api) => ({
  queryKey: apiKey('/settings'),
  queryFn: ({ signal }: { signal: AbortSignal }) => unwrap(api.GET('/settings', { signal })),
  gcTime: Infinity,
});

/**
 * The one way the web changes settings, sent like any change: `change.run(...settingsPatch(p))`.
 * The answer is the new settings, so it goes into the cache and every screen follows at once;
 * every other read is asked again, because the server works most figures out from settings
 * (country, region, rates, currency, time zone, week start).
 */
export const settingsPatch = (patch: Schemas['SettingsPatch']) =>
  [
    (api: Api) => api.PATCH('/settings', { body: patch }),
    (next: Settings) => [put('/settings', undefined, next)],
  ] as const;

export function SessionProvider({ api, children }: { api?: Api; children: ReactNode }) {
  const client = useMemo(() => api ?? createApi(), [api]);
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const queries = useQueryClient();
  const ready = state.status === 'ready';

  const refresh = useCallback(async () => {
    try {
      const setup = await unwrap(client.GET('/setup/status'));
      if (setup.state === 'needs_setup') return setState({ status: 'needs_setup' });
      const settings = await queries.fetchQuery({ ...settingsQuery(client), staleTime: 0 });
      setState({ status: 'ready', settings });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: 'signed_out' });
      else if (e instanceof ApiError && e.code === 'setup_incomplete')
        setState({ status: 'needs_confirmation' });
      else setState({ status: 'error', message: 'The server could not be reached.' });
    }
  }, [client, queries]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While signed in, the session follows the cached settings: a save, an invalidation or a
  // refetch on focus reaches every screen. An emptied entry (a page's "Try again" resets the
  // cache) keeps the last settings until the new answer is in.
  useEffect(() => {
    if (!ready) return;
    const observer = new QueryObserver<Settings, Error, Settings, Settings>(
      queries,
      settingsQuery(client),
    );
    return observer.subscribe(({ data }) => {
      if (data)
        setState((s) =>
          s.status === 'ready' && s.settings !== data ? { ...s, settings: data } : s,
        );
    });
  }, [ready, queries, client]);

  const value = useMemo<SessionValue>(
    () => ({
      api: client,
      state,
      refresh,
      signOut: async () => {
        await client.POST('/auth/logout');
        // Nothing of this account stays in the cache for whoever signs in next.
        queries.clear();
        setState({ status: 'signed_out' });
      },
    }),
    [client, state, refresh, queries],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
