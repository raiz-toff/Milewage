import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { DEVICE_TOKEN, fakeNet, json, makeServices, problem, SETTINGS } from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const HOME = 'http://192.168.1.20:8080';
const AWAY = 'https://box.tail1234.ts.net';
const BOX = { name: 'MileWage (box)', url: HOME, instanceId: 'inst-1' };

/** A server that answers the link flow; `afterPolls` pending polls before the driver typed it. */
function linkServer(o: { afterPolls?: number; expire?: boolean } = {}) {
  const calls: string[] = [];
  let polls = 0;
  let asks = 0;
  const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith('/link-requests')) {
      asks += 1;
      return json(201, {
        device_code: `mwl_${'c'.repeat(43)}`,
        user_code: asks === 1 ? '482913' : '105277',
        expires_in: 600,
        interval: 1,
      });
    }
    if (url.endsWith('/link-requests/poll')) {
      if (o.expire && asks === 1) return problem(410, 'link_expired');
      if (polls++ < (o.afterPolls ?? 0)) return json(202, { status: 'pending' });
      return json(
        201,
        {
          device_id: 9,
          device_token: DEVICE_TOKEN,
          settings: SETTINGS,
          home_url: HOME,
          away_url: AWAY,
        },
        { 'X-MileWage-Instance': 'inst-1' },
      );
    }
    return json(200, url.endsWith('/vehicles') ? [] : {}, { 'X-MileWage-Instance': 'inst-1' });
  });
  return { calls, fetch: fetchFn };
}

describe('linking with a code', () => {
  it('finds the server, shows the code, and connects once the driver types it', async () => {
    const net = fakeNet();
    net.found = [BOX];
    const s = linkServer({ afterPolls: 1 });
    const { services, secure } = makeServices(s.fetch, { net });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.press(await screen.findByRole('button', { name: `MileWage (box), ${HOME}` }));
    expect(await screen.findByText('482 913')).toBeTruthy();
    expect(screen.getByText('Waiting for your computer…')).toBeTruthy();
    expect(await screen.findByText(/^Connected to/, {}, { timeout: 5000 })).toBeTruthy();
    expect(s.calls.slice(0, 3)).toEqual([
      `POST ${HOME}/api/v1/link-requests`,
      `POST ${HOME}/api/v1/link-requests/poll`,
      `POST ${HOME}/api/v1/link-requests/poll`,
    ]);
    // Then the app talks to the server at home, after checking it is the same one.
    expect(s.calls.slice(3, 5)).toEqual([`GET ${HOME}/healthz`, `GET ${HOME}/api/v1/vehicles`]);
    const cred = JSON.parse(secure.data.get('pairing.credential')!);
    expect(cred).toMatchObject({ baseUrl: HOME, homeUrl: HOME, awayUrl: AWAY, deviceId: 9 });
  });

  it('an expired or refused code says so, and Get a new code asks again', async () => {
    const net = fakeNet();
    net.found = [BOX];
    const s = linkServer({ expire: true });
    render(<App services={makeServices(s.fetch, { net }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.press(await screen.findByRole('button', { name: `MileWage (box), ${HOME}` }));
    expect(
      await screen.findByText(/The code expired or was refused/, {}, { timeout: 4000 }),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Get a new code' }));
    expect(await screen.findByText('105 277')).toBeTruthy();
  });

  it('none found: says so and looks again', async () => {
    const net = fakeNet();
    render(<App services={makeServices(jest.fn(), { net }).services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    expect(await screen.findByText(/No MileWage server found on this Wi-Fi/)).toBeTruthy();
    net.found = [BOX];
    fireEvent.press(screen.getByRole('button', { name: 'Look again' }));
    expect(await screen.findByRole('button', { name: `MileWage (box), ${HOME}` })).toBeTruthy();
  });
});
