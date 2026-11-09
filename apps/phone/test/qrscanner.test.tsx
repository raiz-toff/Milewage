/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PermissionsAndroid } from 'react-native';
import { QrScanner } from '../src/pairing/QrScanner';
import { ToastProvider } from '../src/ui/Toast';
import { QR } from './support/mock';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

/** The ZXing camera view, replaced by a stand-in that the test feeds codes through. */
let mockFeed: ((text: string) => void) | null = null;
jest.mock('../native/qr-scanner', () => ({
  loadQrCamera: () =>
    function Camera(p: { onScanned: (e: { nativeEvent: { text: string } }) => void }) {
      mockFeed = (text) => p.onScanned({ nativeEvent: { text } });
      const { Text: MockText } = require('react-native');
      return <MockText>camera</MockText>;
    },
}));

const R = PermissionsAndroid.RESULTS;
const answer = (r: (typeof R)[keyof typeof R]) => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  return jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(r);
};
const show = (onScanned = jest.fn()) => {
  render(
    <ToastProvider>
      <QrScanner onScanned={onScanned} />
    </ToastProvider>,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Scan pairing code' }));
  return onScanned;
};

describe('QR scanner (ZXing, no Google)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockFeed = null;
  });

  it('asks for the camera, says so for a stray code, and passes a pairing code on once', async () => {
    // The stray-code message goes after 2 s of the screen's own timer: fake time, so a busy
    // machine cannot make the wait race the timer.
    jest.useFakeTimers();
    const asked = answer(R.GRANTED);
    const onScanned = show();
    expect(await screen.findByText('camera')).toBeTruthy();
    expect(asked).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
    mockFeed!('https://example.com/menu');
    expect(await screen.findByText(/That is not a MileWage pairing code/)).toBeTruthy();
    expect(onScanned).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1_999));
    expect(screen.queryByText(/not a MileWage/)).toBeTruthy();
    mockFeed!(QR); // still showing the message: codes are not read yet
    expect(onScanned).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText(/not a MileWage/)).toBeNull();
    mockFeed!(QR);
    mockFeed!(QR);
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith(QR);
  });

  it('camera refused: offers to ask again; refused for good: offers app settings', async () => {
    answer(R.DENIED);
    show();
    expect(await screen.findByText('Camera permission is needed to scan.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeTruthy();
    expect(screen.queryByText('camera')).toBeNull();
    jest.restoreAllMocks();
    answer(R.NEVER_ASK_AGAIN);
    fireEvent.press(screen.getByRole('button', { name: 'Scan pairing code' }));
    expect(await screen.findByText('Camera access is off for MileWage.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open app settings' })).toBeTruthy();
  });
});
