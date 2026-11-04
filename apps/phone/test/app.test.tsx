import { fireEvent, render, screen } from '@testing-library/react-native';
import { colors } from '@milewage/shared';
import { App } from '../src/App';
import { makeServices, mockServer } from './support/mock';

/** Fakes at the native edges: the default wiring needs the SQLite and Keystore modules. */
const fakes = () => makeServices(mockServer({}).fetch, { autoUpload: false }).services;

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
    expect(await screen.findByText('Not paired.')).toBeTruthy();
  });

  it.each(['dark', 'light'] as const)('uses the %s design tokens', async (name) => {
    mockScheme = name;
    render(<App services={fakes()} />);
    const text = await screen.findByText('No shift running.');
    expect(text.props.style).toMatchObject({ color: colors[name].textMuted });
  });
});
