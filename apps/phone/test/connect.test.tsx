import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { addressProblem, explainFailure, isTailnetAddress } from '../src/connect/reach';
import { parsePairingPayload } from '../src/pairing/pairing';
import { fakeNet, json, makeServices, TOKEN } from './support/mock';
import { server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const code = (base: string) => `milewage://pair?v=1&u=${encodeURIComponent(base)}&t=${TOKEN}`;
const TAILNET = 'https://box.tail1234.ts.net';

describe('address checks and messages (plan 19 section 3.5)', () => {
  it('knows a tailnet address', () => {
    expect(isTailnetAddress(TAILNET)).toBe(true);
    expect(isTailnetAddress('https://box.tail1234.ts.net:8443')).toBe(true);
    expect(isTailnetAddress('https://ts.net.example.com')).toBe(false);
  });

  it('refuses this-computer addresses always, and http only in a release build', () => {
    for (const u of ['http://localhost:5173', 'https://127.0.0.1', 'http://[::1]:8080']) {
      expect(addressProblem(u, false)).toMatch(/points at the computer that made it/);
    }
    expect(addressProblem('http://192.168.1.20:8080', true)).toMatch(/unsecured address \(http\)/);
    expect(addressProblem('http://192.168.1.20:8080', false)).toBeNull(); // debug build
    expect(addressProblem(TAILNET, true)).toBeNull();
  });

  it('says which step is wrong when connecting fails', () => {
    expect(explainFailure('network', TAILNET, false)).toEqual({
      text: 'Tailscale is off on this phone. Open Tailscale, connect, then try again.',
      tailscale: true,
    });
    expect(explainFailure('network', TAILNET, true).text).toMatch(
      /not answering through Tailscale/,
    );
    expect(explainFailure('network', TAILNET, null).text).toMatch(/Is Tailscale connected/);
    expect(explainFailure('network', 'https://mw.example.net', false).text).toMatch(
      /^Cannot reach the server/,
    );
    expect(explainFailure('not_milewage', TAILNET, null).text).toMatch(/not a MileWage server/);
  });

  it('an answer without the MileWage header is not a MileWage server', async () => {
    const { services } = makeServices(async () => new Response('<html>', { status: 404 }));
    const p = parsePairingPayload(code(TAILNET))!;
    await expect(services.pairing.redeem(p)).rejects.toMatchObject({ code: 'not_milewage' });
  });
});

describe('Connect screen messages', () => {
  const connect = async (base: string) => {
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing code'), code(base));
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
  };

  it('Tailscale off: says so and opens Tailscale', async () => {
    const net = fakeNet(true);
    const fetch = jest.fn(async () => Promise.reject(new TypeError('Network request failed')));
    render(<App services={makeServices(fetch, { net }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing code'), code(TAILNET));
    net.vpn = false; // turned off after the Tailscale check
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/Tailscale is off on this phone/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Open Tailscale' }));
    expect(net.opened).toBe(1);
  });

  it('a code from localhost is refused before anything is sent', async () => {
    const fetch = jest.fn();
    render(<App services={makeServices(fetch).services} />);
    await connect('http://localhost:8080');
    expect(await screen.findByText(/points at the computer that made it/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Tailscale on this phone (plan 24 screen 3)', () => {
  it('missing: the Tailscale screen comes first, installs, and can be skipped', async () => {
    const net = fakeNet(null, false);
    render(<App services={makeServices(jest.fn(), { net }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    expect(await screen.findByText('Get Tailscale on this phone')).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: 'Install Tailscale' }));
    expect(net.opened).toBe(1);
    fireEvent.press(screen.getByRole('button', { name: 'Continue without Tailscale' }));
    expect(await screen.findByText('Connect to your server')).toBeTruthy();
  });

  it('installed but off: offers to open it; on: goes straight to Connect', async () => {
    const net = fakeNet(false, true);
    const view = render(<App services={makeServices(jest.fn(), { net }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    expect(await screen.findByRole('button', { name: 'Open Tailscale' })).toBeTruthy();
    view.unmount();
    render(<App services={makeServices(jest.fn(), { net: fakeNet(true) }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    expect(await screen.findByText('Connect to your server')).toBeTruthy();
  });

  it('home banner: a tailnet server out of reach for 10 minutes with Tailscale off', async () => {
    const net = fakeNet(false);
    const routes = server({ 'POST /shifts': () => json(503, { code: 'x', retryable: true }) });
    const { services, secure } = setup(routes, { paired: true, net });
    const cred = JSON.parse(secure.data.get('pairing.credential')!);
    secure.data.set('pairing.credential', JSON.stringify({ ...cred, baseUrl: TAILNET }));
    await services.shift.start({ vehicleId: 3 });
    await services.shift.end(); // ended at the test clock, long before now
    render(<App services={services} />);
    expect(await screen.findByText(/Tailscale is off on this phone, so/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Open Tailscale' }));
    expect(net.opened).toBe(1);
  });
});
