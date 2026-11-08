import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { RoutePicker, REDISCOVER_MS } from '../src/connect/route';
import { DEVICE_TOKEN, fakeNet, json, makeServices, SETTINGS, TOKEN } from './support/mock';
import { server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const HOME = 'http://192.168.1.20:8080';
const MOVED = 'http://192.168.1.31:8080';
const TAILNET = 'https://box.tail1234.ts.net';

describe('a server that moved on the Wi-Fi (plan 28 section 6, H8)', () => {
  const both = { baseUrl: HOME, homeUrl: HOME, awayUrl: TAILNET, instanceId: 'inst-1' };
  const picker = (local: boolean) => {
    const t = { now: 0 };
    const moved: string[] = [];
    const looked: string[] = [];
    const r = new RoutePicker({
      localNetwork: async () => local,
      probe: async (url) => url === MOVED,
      now: () => t.now,
      rediscover: async (id) => {
        looked.push(id);
        return MOVED;
      },
      onHomeMoved: (url) => void moved.push(url),
    });
    return { r, t, moved, looked };
  };

  it('on Wi-Fi with a silent home address it looks for the same server, at most every 10 minutes', async () => {
    const p = picker(true);
    expect((await p.r.pick(both)).where).toBe('away'); // this request goes away meanwhile
    await waitFor(() => expect(p.moved).toEqual([MOVED]));
    expect(p.looked).toEqual(['inst-1']);
    p.r.forget();
    await p.r.pick(both);
    expect(p.looked).toHaveLength(1);
    p.t.now = REDISCOVER_MS;
    p.r.forget();
    await p.r.pick(both);
    expect(p.looked).toHaveLength(2);
  });

  it('never on mobile data', async () => {
    const p = picker(false);
    await p.r.pick(both);
    expect(p.looked).toEqual([]);
  });

  it('keeps the new home address, and only a home address', async () => {
    const { services, secure } = makeServices(jest.fn(), { paired: true });
    await services.pairing.updateHome(MOVED);
    expect(JSON.parse(secure.data.get('pairing.credential')!).homeUrl).toBe(MOVED);
    await services.pairing.updateHome('http://evil.example.com');
    expect(JSON.parse(secure.data.get('pairing.credential')!).homeUrl).toBe(MOVED);
  });
});

/** A paired phone with these addresses, a shift waiting to be sent for a long time. */
async function waiting(cred: object, routes = server(), net = fakeNet(false)) {
  const made = setup(routes, { paired: true, net });
  const old = JSON.parse(made.secure.data.get('pairing.credential')!);
  made.secure.data.set('pairing.credential', JSON.stringify({ ...old, ...cred }));
  await made.services.shift.start({ vehicleId: 3 });
  await made.services.shift.end(); // ended at the test clock, long before now
  return made;
}

describe('the Home notice says Tailscale only when away (plan 28 section 4.3)', () => {
  it('at home with Tailscale off: no Tailscale hint', async () => {
    const routes = server({
      'POST /shifts': () => json(503, { code: 'x', retryable: true }),
      'GET /healthz': () => json(200, { ok: true }),
    });
    const { services } = await waiting({ baseUrl: HOME, homeUrl: HOME, awayUrl: TAILNET }, routes);
    await services.shift.vehicles(); // a request: the phone picks home
    expect(services.pairing.where).toBe('home');
    render(<App services={services} />);
    expect(await screen.findByText(/^Not yet on server/)).toBeTruthy();
    expect(screen.queryByText(/Tailscale is off on this phone/)).toBeNull();
  });

  it('away with Tailscale off: the hint and Open Tailscale', async () => {
    const routes = server({ 'POST /shifts': () => json(503, { code: 'x', retryable: true }) });
    const net = fakeNet(false);
    net.local = false;
    const { services } = await waiting(
      { baseUrl: HOME, homeUrl: HOME, awayUrl: TAILNET },
      routes,
      net,
    );
    render(<App services={services} />);
    expect(await screen.findByText(/Tailscale is off on this phone, so/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Open Tailscale' }));
    expect(net.opened).toBe(1);
  });

  it('only a home address, off Wi-Fi: shifts wait until home; Tailscale is optional', async () => {
    const net = fakeNet(false);
    net.local = false;
    const routes = server({ 'POST /shifts': () => json(503, { code: 'x', retryable: true }) });
    const { services } = await waiting(
      { baseUrl: HOME, homeUrl: HOME, awayUrl: null },
      routes,
      net,
    );
    render(<App services={services} />);
    expect(await screen.findByText(/You are away from your home Wi-Fi/)).toBeTruthy();
    expect(screen.queryByText(/Tailscale is off on this phone/)).toBeNull();
  });
});

describe('Settings shows both addresses', () => {
  it('home, away, and which one is used now', async () => {
    const routes = server({ 'GET /healthz': () => json(200, { ok: true }) });
    const { services, secure } = setup(routes);
    const old = JSON.parse(secure.data.get('pairing.credential')!);
    secure.data.set(
      'pairing.credential',
      JSON.stringify({ ...old, baseUrl: HOME, homeUrl: HOME, awayUrl: null }),
    );
    await services.shift.vehicles();
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByText(`At home: ${HOME} (using now)`)).toBeTruthy();
    expect(
      screen.getByText('Away: not set up. Shifts are sent when the phone is on your home Wi-Fi.'),
    ).toBeTruthy();
  });
});

describe('Connected says when the phone works only at home', () => {
  it('no away address: works on your home Wi-Fi, Tailscale later and optional', async () => {
    const fetchFn = async (url: string) =>
      url.endsWith('/pairing/redeem')
        ? json(201, {
            device_id: 7,
            device_token: DEVICE_TOKEN,
            settings: SETTINGS,
            home_url: HOME,
            away_url: null,
          })
        : json(200, url.endsWith('/vehicles') ? [{ id: 3, name: 'Civic' }] : { ok: true });
    render(<App services={makeServices(fetchFn).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(
      await screen.findByLabelText('Pairing code'),
      `milewage://pair?v=1&u=${encodeURIComponent(HOME)}&t=${TOKEN}`,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Works on your home Wi-Fi.')).toBeTruthy();
    expect(screen.getByText(/set up Tailscale on your server later/)).toBeTruthy();
  });
});
