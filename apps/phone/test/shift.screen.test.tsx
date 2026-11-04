import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakePermissions } from '../src/permissions/fake';
import { json } from './support/mock';
import { drive, setup, SHIFT, server } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

describe('home screen', () => {
  it('starts and ends a shift, showing live distance in the cached unit', async () => {
    const permissions = new FakePermissions({
      foregroundLocation: 'granted',
      backgroundLocation: 'granted',
    });
    const { services, tracker } = setup(undefined, { paired: true, permissions, refreshMs: 20 });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText('Shift running')).toBeTruthy();
    drive(tracker);
    // 445 m is 0.3 mi in the cached unit (miles).
    await waitFor(() =>
      expect(screen.getByLabelText('Distance').props.children.join('')).toBe('0.3 mi'),
    );
    fireEvent.press(screen.getByRole('button', { name: 'End shift' }));
    expect(await screen.findByText('Shift ended.')).toBeTruthy();
    expect(screen.getByText('No shift running.')).toBeTruthy();
  });

  it('refuses to start without location permission and says why', async () => {
    const { services, routes } = setup();
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText(/Location permission is needed/)).toBeTruthy();
    expect(routes.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers to continue the shift the server already has', async () => {
    const routes = server({
      'POST /shifts': () =>
        json(409, { code: 'shift_already_active', retryable: false, active_shift: SHIFT }),
    });
    const permissions = new FakePermissions({ foregroundLocation: 'granted' });
    const { services, tracker } = setup(routes, { paired: true, permissions });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Continue that shift' }));
    expect(await screen.findByText('Shift running')).toBeTruthy();
    expect(tracker.isTracking()).toBe(true);
  });
});
