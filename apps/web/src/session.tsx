import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, createApi, unwrap } from './api/client';
import type { Api, Settings } from './api/client';

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
  /** Ask the server again (after setup, login, or a settings change). */
  refresh: () => Promise<void>;
  setSettings: (settings: Settings) => void;
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

export function SessionProvider({ api, children }: { api?: Api; children: ReactNode }) {
  const client = useMemo(() => api ?? createApi(), [api]);
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const queries = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const setup = await unwrap(client.GET('/setup/status'));
      if (setup.state === 'needs_setup') return setState({ status: 'needs_setup' });
      const settings = await unwrap(client.GET('/settings'));
      setState({ status: 'ready', settings });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: 'signed_out' });
      else if (e instanceof ApiError && e.code === 'setup_incomplete')
        setState({ status: 'needs_confirmation' });
      else setState({ status: 'error', message: 'The server could not be reached.' });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      api: client,
      state,
      refresh,
      setSettings: (settings) => setState({ status: 'ready', settings }),
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
