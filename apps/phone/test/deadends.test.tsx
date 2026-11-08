import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakePermissions } from '../src/permissions/fake';
import { json } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const allowed = () =>
  new FakePermissions({
    foregroundLocation: 'granted',
    backgroundLocation: 'granted',
    activityRecognition: 'granted',
    notifications: 'granted',
  });

const down = () => json(503, { code: 'x', retryable: true });

/** Every failure says what to do next and leads there; nothing leaves the driver stuck. */
describe('no dead ends', () => {
  it('starts a shift offline with the vehicle list kept from the last connection', async () => {
    let online = true;
    const routes = server({
      'GET /vehicles': () => (online ? json(200, [{ id: 3, name: 'Civic' }]) : down()),
      'POST /shifts': () => down(),
    });
    const { services } = setup(routes, { paired: true, permissions: allowed() });
    expect(await services.shift.vehicles()).toEqual([{ id: 3, name: 'Civic' }]);
    online = false;
    const kept = await services.shift.vehicles();
    expect([...kept]).toEqual([{ id: 3, name: 'Civic' }]);
    expect(kept.offline).toBe(true);

    render(<App services={services} />);
    expect(await screen.findByText(/using the vehicles from your last connection/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText('Shift running')).toBeTruthy();
  });

  it('with no vehicle list at all, says why and offers to try again', async () => {
    const routes = server({ 'GET /vehicles': () => down() });
    const { services } = setup(routes, { paired: true, permissions: allowed() });
    render(<App services={services} />);
    expect(await screen.findByText(/Your vehicles could not be loaded/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText('Your vehicles have not loaded.')).toBeTruthy();
    expect(screen.queryByText('Shift running')).toBeNull();
  });

  it('a missing permission leads to the Permissions screen', async () => {
    const { services } = setup();
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Fix permissions' }));
    expect(await screen.findByText(/What MileWage needs/)).toBeTruthy();
  });

  it('a shift that is gone shows why and a way back', async () => {
    const { services } = setup(server({ 'POST /shifts': () => down() }), {
      paired: true,
      permissions: allowed(),
    });
    await services.shift.start({ vehicleId: 3 });
    await services.shift.end();
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    const row = await screen.findByRole('button', { name: /^Shift / });
    // Deleted on the server while the list was open, as a sync tombstone would do.
    await services.shifts.remove(ID);
    fireEvent.press(row);
    expect(await screen.findByText('This shift is no longer on this phone.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Back to shifts' }));
    expect(await screen.findByText('No shifts yet.')).toBeTruthy();
  });
});
