import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { DEVICE_TOKEN, json, makeServices, mockServer, QR, SETTINGS } from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const serverWith = (vehicles: () => object[]) =>
  mockServer({
    'POST /pairing/redeem': () =>
      json(201, {
        device_id: 7,
        device_token: DEVICE_TOKEN,
        settings: { ...SETTINGS, country: 'CA', region: 'ON', display_name: 'Sam' },
      }),
    'GET /vehicles': () => json(200, vehicles()),
  });

const connect = async () => {
  fireEvent.press(await screen.findByRole('button', { name: 'I have a server' }));
  fireEvent.changeText(await screen.findByLabelText('Pairing code'), QR);
  fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
};

describe('after connecting (plan 24 screens 5 and 10)', () => {
  it('shows what the server sent, then Ready, then Home', async () => {
    render(
      <App services={makeServices(serverWith(() => [{ id: 3, name: 'Civic' }]).fetch).services} />,
    );
    await connect();
    expect(await screen.findByText('Connected to https://mw.example.net as Sam.')).toBeTruthy();
    expect(screen.getByText('ON')).toBeTruthy();
    expect(screen.getByText('Civic')).toBeTruthy();
    expect(screen.queryByText(/add your vehicle/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Go to home' }));
    expect(await screen.findByText('No shift running.')).toBeTruthy();
  });

  it('no vehicle: sends the driver to the web, and Check again picks it up', async () => {
    let list: object[] = [];
    render(<App services={makeServices(serverWith(() => list).fetch).services} />);
    await connect();
    expect(await screen.findByText('Finish setup on the web: add your vehicle.')).toBeTruthy();
    list = [{ id: 4, name: 'Bike' }];
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Bike')).toBeTruthy();
    expect(screen.queryByText(/add your vehicle/)).toBeNull();
  });

  it('a phone already connected before this update goes straight to Home', async () => {
    render(<App services={makeServices(serverWith(() => []).fetch, { paired: true }).services} />);
    expect(await screen.findByText('No shift running.')).toBeTruthy();
  });
});
