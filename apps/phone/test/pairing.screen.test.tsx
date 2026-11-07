import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { App } from '../src/App';
import {
  DEVICE_TOKEN,
  json,
  makeServices,
  mockServer,
  problem,
  QR,
  SETTINGS,
} from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const okServer = () =>
  mockServer({
    'POST /pairing/redeem': () =>
      json(201, { device_id: 7, device_token: DEVICE_TOKEN, settings: SETTINGS }),
    'GET /settings': () => json(200, { ...SETTINGS, distance_unit: 'km' }),
  });

/** After connecting from the first run: Connected, Ready, then Home. */
const finishSetup = async () => {
  fireEvent.press(await screen.findByRole('button', { name: 'Next' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Go to home' }));
};

describe('settings screen', () => {
  it('pairs from a pasted link, then shows flag-driven lines and unpairs', async () => {
    const { services } = makeServices(okServer().fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    expect(await screen.findByText('Connect to your server')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Pairing code'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Phone connected.')).toBeTruthy();
    await finishSetup();
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Paired to https://mw.example.net')).toBeTruthy();
    expect(await screen.findByText('Distances in kilometres.')).toBeTruthy();
    expect(screen.getByText('Stops and the estimated split are on.')).toBeTruthy();
    // Changing server asks first: Cancel keeps the connection, Disconnect ends it and says so.
    const change = 'Connect to a different server';
    fireEvent.press(screen.getByRole('button', { name: change }));
    expect(await screen.findByText(`${change}?`)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(`${change}?`)).toBeNull());
    expect(screen.getByText(/Paired to/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: change }));
    fireEvent.press(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Welcome to MileWage')).toBeTruthy();
    expect(screen.getByText('Phone disconnected.')).toBeTruthy();
  });

  it('tracking off on the server hides the stops line and says so', async () => {
    const server = mockServer({
      'POST /pairing/redeem': () =>
        json(201, {
          device_id: 1,
          device_token: DEVICE_TOKEN,
          settings: { ...SETTINGS, modules: { tracking: false, stops: true } },
        }),
      'GET /settings': () => json(200, { ...SETTINGS, modules: { tracking: false, stops: true } }),
    });
    const { services } = makeServices(server.fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing code'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    await finishSetup();
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Tracking is turned off on the server.')).toBeTruthy();
    expect(screen.queryByText('Stops and the estimated split are on.')).toBeNull();
  });

  it('shows a clear message for a bad or used code and for a stray QR', async () => {
    const server = mockServer({
      'POST /pairing/redeem': () => problem(401, 'invalid_pairing_token'),
    });
    const { services } = makeServices(server.fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing code'), 'hello');
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('That is not a MileWage pairing code.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Pairing code'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/not valid, has expired or was already used/)).toBeTruthy();
  });
});

describe('pairing link that opens the app (the phone camera scanned the QR)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks which server first, then pairs', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce(QR);
    const server = okServer();
    const { services } = makeServices(server.fetch);
    render(<App services={services} />);
    expect(await screen.findByText('Connect to this server?')).toBeTruthy();
    expect(screen.getByText(/https:\/\/mw\.example\.net/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Yes, connect' }));
    expect(await screen.findByText('Phone connected.')).toBeTruthy();
    expect(await screen.findByText(/^Connected to https:\/\/mw\.example\.net/)).toBeTruthy();
  });

  it('Cancel leaves the phone unpaired and sends nothing', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce(QR);
    const server = okServer();
    const { services } = makeServices(server.fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Connect to this server?')).toBeNull());
    expect(screen.getByText('Connect to your server')).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/pairing/redeem')).toBe(false);
  });

  it('an already paired phone says so instead of switching servers', async () => {
    const server = okServer();
    const { services } = makeServices(server.fetch, { paired: true });
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce(QR);
    render(<App services={services} />);
    expect(await screen.findByText('This phone is already connected.')).toBeTruthy();
    expect(screen.queryByText('Connect to this server?')).toBeNull();
  });
});
