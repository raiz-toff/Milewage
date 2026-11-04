import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/App';
import { createApi } from '../../src/api/client';
import type { Modules, Settings } from '../../src/api/client';
import { SessionProvider } from '../../src/session';

export type Handler = (req: { body: unknown; url: URL }) => { status?: number; body?: unknown };
export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export const ALL_ON: Modules = {
  sync: true,
  devices: true,
  tracking: true,
  replay: true,
  live: true,
  stops: true,
  diagnostics: true,
  capture: false,
  backup_download: false,
  exporters: ['csv', 'gpx', 'geojson'],
  countries: ['US', 'CA', 'GB'],
};

export function settingsFixture(
  over: Partial<Settings> & { modules?: Partial<Modules> } = {},
): Settings {
  return {
    country: 'CA',
    distance_unit: 'km',
    currency: 'CAD',
    timezone: 'America/Toronto',
    raw_retention_days: 90,
    stops_enabled: true,
    engine_version: 3,
    diagnostics: { level: 'basic', verbose_until: null, capture: null },
    ...over,
    modules: { ...ALL_ON, ...over.modules },
  };
}

/** A fetch that answers from a table keyed `METHOD /path` (without /api/v1). Unlisted = 404. */
export function fakeServer(table: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl = (async (req: Request) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path, body });
    const handler = table[`${req.method} ${path}`];
    if (!handler) {
      return problem(404, 'not_found');
    }
    const r = handler({ body, url });
    const status = r.status ?? 200;
    if (status >= 400)
      return problem(status, (r.body as { code?: string } | undefined)?.code ?? 'error', r.body);
    if (r.body === undefined) return new Response(null, { status: status === 200 ? 204 : status });
    return new Response(JSON.stringify(r.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls, api: createApi(fetchImpl) };
}

function problem(status: number, code: string, extra?: unknown) {
  const body = {
    type: 'about:blank',
    title: code,
    status,
    code,
    retryable: false,
    ...(extra as object),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** The whole app against a fake server, starting at `url`. */
export function renderApp(table: Record<string, Handler>, url = '/') {
  const server = fakeServer(table);
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <SessionProvider api={server.api}>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { ...server, ...view };
}

export const signedIn = (settings: Settings = settingsFixture()): Record<string, Handler> => ({
  'GET /setup/status': () => ({ body: { state: 'ready' } }),
  'GET /settings': () => ({ body: settings }),
});
