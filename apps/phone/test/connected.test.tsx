import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakePermissions } from '../src/permissions/fake';
import { FakeTracker } from '../src/tracker/fake';
import { finishSetup } from './support/firstRun';
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

describe('after connecting (plan 24 screens 5 to 10)', () => {
  it('shows what the server sent, then Ready, then Home', async () => {
    render(
      <App services={makeServices(serverWith(() => [{ id: 3, name: 'Civic' }]).fetch).services} />,
    );
    await connect();
    expect(await screen.findByText('Connected to https://mw.example.net as Sam.')).toBeTruthy();
    expect(screen.getByText('ON')).toBeTruthy();
    expect(screen.getByText('Civic')).toBeTruthy();
    expect(screen.queryByText(/add your vehicle/)).toBeNull();
    await finishSetup();
    expect(await screen.findByText('No shift running.')).toBeTruthy();
    // Every step was left for later, so Home lists them.
    expect(screen.getByText('Allow location all the time')).toBeTruthy();
    expect(screen.getByText('Keep MileWage running')).toBeTruthy();
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

describe('permission steps (plan 24 screens 6 to 9)', () => {
  it('asks one at a time in the ladder order, then Ready', async () => {
    const permissions = new FakePermissions();
    const tracker = new FakeTracker();
    const { services } = makeServices(serverWith(() => [{ id: 3, name: 'Civic' }]).fetch, {
      permissions,
      tracker,
    });
    render(<App services={services} />);
    await connect();
    fireEvent.press(await screen.findByRole('button', { name: 'Next' }));
    for (const action of [
      'I understand',
      'Allow location',
      'Open settings',
      'Allow movement',
      'Allow notifications',
      'Open battery settings',
    ]) {
      fireEvent.press(await screen.findByRole('button', { name: action }));
    }
    expect(await screen.findByText("You're ready")).toBeTruthy();
    expect(permissions.requests).toEqual(['foreground', 'background', 'activity', 'notifications']);
    expect(tracker.batterySettingsOpened).toBe(1);
  });

  it('a step already allowed is not shown', async () => {
    const permissions = new FakePermissions({
      foregroundLocation: 'granted',
      backgroundLocation: 'granted',
      activityRecognition: 'granted',
      notifications: 'granted',
    });
    const { services, plain } = makeServices(serverWith(() => []).fetch, { permissions });
    plain.data.set('perm.batteryVisited', '1');
    render(<App services={services} />);
    await connect();
    fireEvent.press(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.press(await screen.findByRole('button', { name: 'I understand' }));
    expect(await screen.findByText("You're ready")).toBeTruthy();
    expect(permissions.requests).toEqual([]);
  });
});
