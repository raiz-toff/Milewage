import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/App';
import { createApi } from '../../src/api/client';
import type { Modules, Settings } from '../../src/api/client';
import { SessionProvider } from '../../src/session';
import { countriesFixture } from './fixtures';

// jsdom has no matchMedia; the shadcn sidebar and the theme switcher query it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
// jsdom 29's Blob has no stream(), which Node's Request calls to read a File body (receipt upload).
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
  Blob.prototype.stream = function stream(this: Blob) {
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(new Uint8Array(await this.arrayBuffer()));
        controller.close();
      },
    }) as ReturnType<Blob['stream']>;
  };
}
// jsdom has no ResizeObserver either; Radix's Switch measures its thumb with it.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// Radix Select scrolls the chosen option into view and checks pointer capture; jsdom has neither.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}

/** Choose `value` in the dropdown (shadcn Select) named `label`, or in the given trigger. */
export function pick(target: string | HTMLElement, value: string) {
  const trigger = typeof target === 'string' ? screen.getByLabelText(target) : target;
  fireEvent.click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.getAttribute('data-value') === value,
  );
  if (!option) throw new Error(`No option "${value}" in ${trigger.textContent ?? 'dropdown'}`);
  fireEvent.click(option);
}

const actionsFor = (name: string | RegExp) =>
  screen.getByRole('button', {
    name:
      typeof name === 'string'
        ? `Actions for ${name}`
        : new RegExp(`^Actions for .*${name.source}`),
  });

/** Open a row's "..." menu (shadcn DropdownMenu); `name` is the row's name or a part of it. */
export function openMenu(name: string | RegExp) {
  fireEvent.keyDown(actionsFor(name), { key: 'Enter' });
}

/** Open a row's "..." menu and choose `item`. */
export function menu(name: string | RegExp, item: string | RegExp) {
  openMenu(name);
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

/** The values a dropdown offers, read by opening it and closing it again. */
export function optionsOf(target: string | HTMLElement): string[] {
  const trigger = typeof target === 'string' ? screen.getByLabelText(target) : target;
  fireEvent.click(trigger);
  const values = [...document.querySelectorAll('[role="option"]')].map(
    (o) => o.getAttribute('data-value') ?? '',
  );
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  return values;
}

export type Handler = (req: { body: unknown; url: URL }) => {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};
export interface Call {
  method: string;
  path: string;
  body: unknown;
  contentType: string;
}

export const ALL_ON: Modules = {
  sync: true,
  devices: true,
  tracking: true,
  replay: true,
  stops: true,
  diagnostics: true,
  capture: false,
  platforms: true,
  earnings: true,
  expenses: true,
  receipts: true,
  tax: true,
  goals: true,
  analytics: true,
  maintenance: true,
  import: true,
  notifications: true,
  schedule: true,
  progress: true,
  backup_download: false,
  exporters: ['csv', 'gpx', 'geojson'],
  countries: ['US', 'CA', 'GB'],
};

export function settingsFixture(
  over: Omit<Partial<Settings>, 'modules'> & { modules?: Partial<Modules> } = {},
): Settings {
  return {
    country: 'CA',
    distance_unit: 'km',
    currency: 'CAD',
    timezone: 'America/Toronto',
    raw_retention_days: 90,
    stops_enabled: true,
    display_name: null,
    region: null,
    logbook: null,
    week_start: 1,
    time_format: '24h',
    default_vehicle_id: null,
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
    const contentType = req.headers.get('content-type') ?? '';
    // jsdom's File streams never finish under Node's Request, so a multipart body is not read.
    const text = contentType.includes('multipart') ? '' : await req.text();
    const body = text ? (contentType.includes('json') ? JSON.parse(text) : text) : undefined;
    calls.push({ method: req.method, path, body, contentType });
    const handler = table[`${req.method} ${path}`];
    if (!handler) {
      return problem(404, 'not_found');
    }
    const r = handler({ body, url });
    const status = r.status ?? 200;
    if (status >= 400)
      return problem(
        status,
        (r.body as { code?: string } | undefined)?.code ?? 'error',
        r.body,
        r.headers,
      );
    if (r.body === undefined) return new Response(null, { status: status === 200 ? 204 : status });
    return new Response(JSON.stringify(r.body), {
      status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof fetch;
  return { fetchImpl, calls, api: createApi(fetchImpl) };
}

function problem(
  status: number,
  code: string,
  extra?: unknown,
  headers: Record<string, string> = {},
) {
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
    headers: { 'content-type': 'application/problem+json', ...headers },
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
  'GET /countries': () => ({ body: countriesFixture() }),
  'GET /platforms': () => ({ body: [] }),
  'GET /notifications': () => ({ body: { items: [], next_cursor: null, unread_count: 0 } }),
  'GET /notifications/prefs': () => ({
    body: {
      shift_reminders: true,
      goals: true,
      tax_deadlines: true,
      streak: true,
      backup: true,
      sync_reminder: true,
    },
  }),
});
