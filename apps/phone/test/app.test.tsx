import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';
import { App } from '../src/App';
import { INSTALL_GUIDE_URL } from '../src/firstrun/links';
import { makeServices, mockServer } from './support/mock';
import { setup } from './support/shiftKit';

/** Fakes at the native edges: the default wiring needs the SQLite and Keystore modules. */
const fakes = (paired = true) =>
  makeServices(mockServer({}).fetch, { autoUpload: false, paired }).services;

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

let mockScheme: 'dark' | 'light' = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

describe('app shell', () => {
  it('renders the home screen and navigates to settings', async () => {
    render(<App services={fakes()} />);
    expect(await screen.findByText('No shift running.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Paired to https://mw.example.net')).toBeTruthy();
  });

  it.each(['dark', 'light'] as const)('renders in the %s scheme', async (name) => {
    mockScheme = name;
    render(<App services={fakes()} />);
    expect(await screen.findByText('No shift running.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start shift' })).toBeTruthy();
  });
});

describe('first run gate (24 section 4)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a phone that is not paired sees only the first-run screens', async () => {
    render(<App services={fakes(false)} />);
    expect(await screen.findByText('Welcome to MileWage')).toBeTruthy();
    expect(screen.queryByText('No shift running.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'I have a server' }));
    expect(await screen.findByText('Not paired.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(await screen.findByText('Welcome to MileWage')).toBeTruthy();
  });

  it('without a server: the steps, shared or opened, then on to connecting', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    render(<App services={fakes(false)} />);
    fireEvent.press(await screen.findByRole('button', { name: "I don't have one yet" }));
    expect(await screen.findByText('Set up your server')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Send these steps to my computer' }));
    const sent = share.mock.calls[0]![0] as { message: string };
    expect(sent.message).toContain('1. Install MileWage.');
    expect(sent.message).toContain(`Install guide: ${INSTALL_GUIDE_URL}`);
    fireEvent.press(screen.getByRole('button', { name: 'Open the guide' }));
    expect(open).toHaveBeenCalledWith(INSTALL_GUIDE_URL);
    fireEvent.press(screen.getByRole('button', { name: 'My server is ready' }));
    expect(await screen.findByText('Not paired.')).toBeTruthy();
  });

  it('a phone the server disconnected goes back to Welcome and says so', async () => {
    const { services, plain } = makeServices(mockServer({}).fetch, { paired: true });
    plain.data.set('pairing.revoked', '1');
    render(<App services={services} />);
    expect(await screen.findByText(/disconnected from your server. Connect again/)).toBeTruthy();
    expect(screen.queryByText('No shift running.')).toBeNull();
  });

  it('a running shift stays on screen even after the server disconnected the phone', async () => {
    const { services, plain } = setup();
    await services.shift.start({ vehicleId: 3 });
    plain.data.set('pairing.revoked', '1');
    render(<App services={services} />);
    expect(await screen.findByText('Shift running')).toBeTruthy();
    expect(screen.queryByText('Welcome to MileWage')).toBeNull();
  });
});
