import { ApiClient, ApiError } from '../src/api/client';
import { explainFailure } from '../src/connect/reach';
import { addressesOf, healthProbe, RoutePicker, REMEMBER_MS } from '../src/connect/route';
import { parsePairingLink } from '@milewage/shared';
import { DEVICE_TOKEN, fakeNet, json, makeServices, SETTINGS, TOKEN } from './support/mock';

const HOME = 'http://192.168.1.20:8080';
const AWAY = 'https://box.tail1234.ts.net';
const code = (h?: string) =>
  `milewage://pair?v=1&u=${encodeURIComponent(AWAY)}&t=${TOKEN}${h ? `&h=${encodeURIComponent(h)}` : ''}`;

/** A home server and an away server; `homeUp` turns the home one off (out of the house). */
function servers(o: { homeUp?: boolean; instance?: string } = {}) {
  const state = { homeUp: o.homeUp ?? true };
  const calls: string[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (url.startsWith(HOME) && !state.homeUp) throw new TypeError('Network request failed');
    const headers = { 'X-MileWage-Instance': o.instance ?? 'inst-1' };
    if (url.endsWith('/healthz')) return json(200, { ok: true }, headers);
    if (url.endsWith('/pairing/redeem')) {
      const body = {
        device_id: 7,
        device_token: DEVICE_TOKEN,
        settings: SETTINGS,
        home_url: HOME,
        away_url: AWAY,
      };
      return json(201, body, headers);
    }
    return json(200, SETTINGS, headers);
  };
  return { state, calls, fetch: fetchFn };
}

describe('plain http only on the home network (owner decision 2026-11-08)', () => {
  it('refuses http to any other address before sending anything', async () => {
    const sent: string[] = [];
    const client = (baseUrl: string, anyHttp = false) =>
      new ApiClient({
        baseUrl,
        anyHttp,
        fetch: async (url) => {
          sent.push(url);
          return json(200, {});
        },
      });
    for (const bad of ['http://box.example.com', 'http://8.8.8.8:8080', 'http://box.ts.net']) {
      const e = await client(bad)
        .request('GET', '/settings')
        .catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ code: 'insecure_address', retryable: false });
    }
    expect(sent).toEqual([]);
    await client(HOME).request('GET', '/settings');
    await client('http://milewage.local').request('GET', '/settings');
    await client(AWAY).request('GET', '/settings');
    await client('http://box.example.com', true).request('GET', '/settings'); // debug build
    expect(sent).toHaveLength(4);
  });

  it('at home there is no Tailscale to blame', () => {
    expect(explainFailure('network', HOME, false)).toEqual({
      text: `Can't reach your server at ${HOME}. Check that this phone is on the same Wi-Fi as the server and that the server is on.`,
    });
  });
});

describe('home or away (plan 28 section 4.3)', () => {
  const picker = (o: { local?: boolean | null; answers?: boolean; t?: { now: number } } = {}) => {
    const probes: string[] = [];
    const t = o.t ?? { now: 0 };
    const r = new RoutePicker({
      localNetwork: async () => (o.local === undefined ? true : o.local),
      probe: async (url) => {
        probes.push(url);
        return o.answers ?? true;
      },
      now: () => t.now,
    });
    return { r, probes, t };
  };
  const both = { baseUrl: AWAY, homeUrl: HOME, awayUrl: AWAY, instanceId: 'inst-1' };

  it('one address: that one, without looking', async () => {
    const { r, probes } = picker();
    expect(await r.pick({ baseUrl: AWAY, instanceId: null })).toEqual({ url: AWAY, where: 'away' });
    expect(await r.pick({ baseUrl: HOME, instanceId: null })).toEqual({ url: HOME, where: 'home' });
    expect(probes).toEqual([]);
  });

  it('a phone from before plan 28 reads its one address as home or away', () => {
    expect(addressesOf({ baseUrl: HOME, instanceId: null })).toEqual({ home: HOME, away: null });
    expect(addressesOf({ baseUrl: AWAY, instanceId: null })).toEqual({ home: null, away: AWAY });
  });

  it('on Wi-Fi and the home address answers: home; on mobile data: away without trying', async () => {
    expect(await picker().r.pick(both)).toEqual({ url: HOME, where: 'home' });
    const mobile = picker({ local: false });
    expect(await mobile.r.pick(both)).toEqual({ url: AWAY, where: 'away' });
    expect(mobile.probes).toEqual([]);
    expect((await picker({ local: null }).r.pick(both)).where).toBe('home'); // cannot tell: try
    expect(await picker({ answers: false }).r.pick(both)).toEqual({ url: AWAY, where: 'away' });
  });

  it('remembers for a minute, and looks again after a request got no answer', async () => {
    const { r, probes, t } = picker();
    await r.pick(both);
    t.now = REMEMBER_MS - 1;
    await r.pick(both);
    expect(probes).toHaveLength(1);
    r.forget();
    await r.pick(both);
    t.now += REMEMBER_MS;
    await r.pick(both);
    expect(probes).toHaveLength(3);
  });

  it('the probe wants a quick MileWage answer from the same server', async () => {
    const answer = (headers: Record<string, string>, status = 200) =>
      healthProbe(async () => new Response('{}', { status, headers }));
    const mw = { 'X-MileWage-Api': '1', 'X-MileWage-Instance': 'inst-1' };
    expect(await answer(mw)(HOME, 'inst-1')).toBe(true);
    expect(await answer(mw)(HOME, null)).toBe(true);
    expect(await answer(mw)(HOME, 'inst-2')).toBe(false); // another MileWage on that address
    expect(await answer({})(HOME, null)).toBe(false); // not MileWage
    expect(await answer(mw, 503)(HOME, 'inst-1')).toBe(false);
    const never = healthProbe(() => new Promise<Response>(() => {}), 20);
    expect(await never(HOME, null)).toBe(false); // gives up after the timeout
  });
});

describe('a phone with both addresses', () => {
  it('redeems a code at home on the Wi-Fi, and keeps both addresses', async () => {
    const s = servers();
    const { services } = makeServices(s.fetch);
    const state = await services.pairing.redeem(parsePairingLink(code(HOME))!);
    expect(s.calls).toEqual([`GET ${HOME}/healthz`, `POST ${HOME}/api/v1/pairing/redeem`]);
    expect(state.credential).toMatchObject({ baseUrl: HOME, homeUrl: HOME, awayUrl: AWAY });
  });

  it('on mobile data it redeems at the away address and learns home from the code', async () => {
    const s = servers();
    const net = fakeNet();
    net.local = false;
    const { services } = makeServices(s.fetch, { net });
    const state = await services.pairing.redeem(parsePairingLink(code(HOME))!);
    expect(s.calls).toEqual([`POST ${AWAY}/api/v1/pairing/redeem`]);
    expect(state.credential).toMatchObject({ baseUrl: AWAY, homeUrl: HOME, awayUrl: AWAY });
  });

  it('sends home while home answers, and away once it stops, without asking the driver', async () => {
    const s = servers();
    const { services } = makeServices(s.fetch);
    await services.pairing.redeem(parsePairingLink(code(HOME))!);
    s.calls.length = 0;
    const session = (await services.pairing.session())!;
    await session.client.request('GET', '/settings');
    expect(s.calls).toEqual([`GET ${HOME}/healthz`, `GET ${HOME}/api/v1/settings`]);
    s.state.homeUp = false; // the driver leaves the house
    s.calls.length = 0;
    await expect(session.client.request('GET', '/settings')).rejects.toMatchObject({
      code: 'network',
    });
    await session.client.request('GET', '/settings'); // looks again: home is gone, away it is
    expect(s.calls).toEqual([
      `GET ${HOME}/api/v1/settings`,
      `GET ${HOME}/healthz`,
      `GET ${AWAY}/api/v1/settings`,
    ]);
  });

  it('a server answer cannot lower the rules: home must be a home address, away https', async () => {
    const fetchFn = async () =>
      json(201, {
        device_id: 7,
        device_token: DEVICE_TOKEN,
        settings: SETTINGS,
        home_url: 'http://evil.example.com',
        away_url: 'http://box.example.com',
      });
    const { services } = makeServices(fetchFn);
    const state = await services.pairing.redeem({ baseUrl: HOME, token: TOKEN });
    expect(state.credential).toMatchObject({ homeUrl: HOME, awayUrl: null });
    const other = makeServices(fetchFn).services;
    const away = await other.pairing.redeem({ baseUrl: AWAY, token: TOKEN });
    expect(away.credential).toMatchObject({ homeUrl: null, awayUrl: AWAY });
  });
});
