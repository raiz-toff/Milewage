import { fireEvent, render, screen } from '@testing-library/react-native';
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

describe('settings screen', () => {
  it('pairs from a pasted link, then shows flag-driven lines and unpairs', async () => {
    const { services } = makeServices(okServer().fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Not paired.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Pairing link'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('Paired to https://mw.example.net')).toBeTruthy();
    expect(await screen.findByText('Distances in miles.')).toBeTruthy();
    expect(screen.getByText('Stops and the estimated split are on.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Unpair this phone' }));
    expect(await screen.findByText('Not paired.')).toBeTruthy();
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
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing link'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('Tracking is turned off on the server.')).toBeTruthy();
    expect(screen.queryByText('Stops and the estimated split are on.')).toBeNull();
  });

  it('shows a clear message for a bad or used code and for a stray QR', async () => {
    const server = mockServer({
      'POST /pairing/redeem': () => problem(401, 'invalid_pairing_token'),
    });
    const { services } = makeServices(server.fetch);
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.changeText(await screen.findByLabelText('Pairing link'), 'hello');
    fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('That is not a MileWage pairing code.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Pairing link'), QR);
    fireEvent.press(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText(/not valid, has expired or was already used/)).toBeTruthy();
  });
});
