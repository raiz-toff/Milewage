import { gunzipSync, strFromU8 } from 'fflate';
import { MemoryStore, type CachedSettings } from '../../src/pairing/pairing';
import { FakePermissions } from '../../src/permissions/fake';
import { createServices, type Parts, type Services } from '../../src/services';
import { FakeTracker } from '../../src/tracker/fake';
import { openNodeAppDb } from './nodeSql';

export interface Recorded {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (req: Recorded) => Response | Promise<Response>;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export const problem = (status: number, code: string, retryable = false, headers = {}) =>
  json(status, { type: 'about:blank', title: code, status, code, retryable }, headers);

/** A mock server: `routes` keyed `METHOD /path` (path without /api/v1); every call is recorded. */
export function mockServer(routes: Record<string, Handler>) {
  const calls: Recorded[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const raw = init.body;
    let body: unknown = raw;
    if (typeof raw === 'string') body = JSON.parse(raw);
    else if (raw instanceof Uint8Array) body = JSON.parse(strFromU8(gunzipSync(raw)));
    const req: Recorded = {
      method: String(init.method),
      url,
      path,
      headers: { ...(init.headers as Record<string, string>) },
      body,
    };
    calls.push(req);
    const h = routes[`${req.method} ${path}`];
    return h ? h(req) : problem(404, 'not_found');
  };
  return { fetch: fetchFn, calls, routes };
}

export const SETTINGS: CachedSettings = {
  country: 'US',
  distance_unit: 'mi',
  currency: 'USD',
  timezone: 'America/New_York',
  stops_enabled: true,
  engine_version: 1,
  diagnostics: { level: 'basic', verbose_until: null },
  modules: { tracking: true, stops: true, diagnostics: true },
};

export const TOKEN = `mwp_${'a'.repeat(43)}`;
export const DEVICE_TOKEN = `mwd_${'b'.repeat(43)}`;
export const QR = `milewage://pair?v=1&u=${encodeURIComponent('https://mw.example.net')}&t=${TOKEN}`;

/** Services over fakes. `paired` writes a credential and cached settings straight into storage. */
export function makeServices(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  over: Partial<Parts> & { paired?: Partial<CachedSettings> | boolean } = {},
) {
  const secure = new MemoryStore();
  const plain = new MemoryStore();
  const tracker = (over.tracker as FakeTracker | undefined) ?? new FakeTracker();
  const { paired, ...rest } = over;
  if (paired) {
    secure.data.set(
      'pairing.credential',
      JSON.stringify({
        baseUrl: 'https://mw.example.net',
        deviceId: 7,
        deviceToken: DEVICE_TOKEN,
        instanceId: null,
      }),
    );
    plain.data.set(
      'pairing.settings',
      JSON.stringify({ ...SETTINGS, ...(typeof paired === 'object' ? paired : {}) }),
    );
  }
  const services: Services = createServices({
    tracker,
    permissions: new FakePermissions(),
    secure,
    plain,
    openAppDb: async () => openNodeAppDb(),
    fetch: fetchFn,
    autoUpload: false,
    ...rest,
  });
  return { services, secure, plain, tracker };
}
