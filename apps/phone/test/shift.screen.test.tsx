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
      expect(screen.getByLabelText('Distance').props.accessibilityValue.text).toBe('0.3 mi'),
    );
    expect(screen.getByLabelText('Time')).toBeTruthy();
    expect(screen.getByText('Civic · since 19:00')).toBeTruthy();
    // One End shift button, and it asks first; Keep recording leaves the shift running.
    fireEvent.press(screen.getByRole('button', { name: 'End shift' }));
    expect(await screen.findByText('End this shift?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Keep recording' }));
    await waitFor(() => expect(screen.queryByText('End this shift?')).toBeNull());
    expect(screen.getByText('Shift running')).toBeTruthy();
    expect(tracker.isTracking()).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'End shift' }));
    fireEvent.press((await screen.findAllByRole('button', { name: 'End shift' })).at(-1)!);
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

  it('shows a vehicle picker when there are several and starts with the chosen one', async () => {
    const routes = server({
      'GET /vehicles': () =>
        json(200, [
          { id: 3, name: 'Civic' },
          { id: 4, name: 'Van' },
        ]),
    });
    const permissions = new FakePermissions({ foregroundLocation: 'granted' });
    const { services } = setup(routes, { paired: true, permissions });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('radio', { name: 'Van' }));
    expect(screen.getByRole('radio', { name: 'Van' }).props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'Start shift' }));
    await screen.findByText('Shift running');
    const post = routes.calls.find((c) => c.method === 'POST' && c.path === '/shifts')!;
    expect((post.body as { vehicle_id: number }).vehicle_id).toBe(4);
    // the next launch preselects it
    expect(await services.shift.lastVehicleId()).toBe(4);
  });

  it('a single vehicle is shown, not offered as a choice', async () => {
    const { services } = setup();
    render(<App services={services} />);
    expect(await screen.findByText('Vehicle: Civic')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('asks what to do when a retried create hits 409, and continues the server shift on request', async () => {
    let offline = true;
    const routes = server({
      'POST /shifts': () =>
        offline
          ? json(503, { code: 'x', retryable: true })
          : json(409, {
              code: 'shift_already_active',
              retryable: false,
              active_shift: { ...SHIFT, client_id: 'other' },
            }),
    });
    const permissions = new FakePermissions({ foregroundLocation: 'granted' });
    const { services } = setup(routes, { paired: true, permissions });
    await services.shift.start({ vehicleId: 3 });
    offline = false;
    render(<App services={services} />);
    expect(await screen.findByText(/Another shift is already running on the server/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Continue the server shift instead' }));
    await waitFor(() => expect(services.shift.current?.clientId).toBe('other'));
    expect(screen.queryByText(/Another shift is already running/)).toBeNull();
  });
});
