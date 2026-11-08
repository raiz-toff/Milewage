import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakePermissions } from '../src/permissions/fake';
import {
  lastOdometerCheck,
  markOdometerChecked,
  ODOMETER_EVERY_MS,
  odometerDue,
} from '../src/shift/odometerDue';
import { ID, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const DAY = 24 * 60 * 60 * 1000;
const zone = 'America/New_York';
const at = (iso: string) => Date.parse(iso);

describe('odometer cadence (Comma: monthly, or 14 days since the last check)', () => {
  it('asks the first time, then not again for 14 days in the same month', () => {
    const now = at('2026-11-20T15:00:00Z');
    expect(odometerDue({ now, zone, lastCheck: null })).toBe(true);
    expect(odometerDue({ now, zone, lastCheck: now - 13 * DAY })).toBe(false);
    expect(odometerDue({ now, zone, lastCheck: now - DAY })).toBe(false);
    expect(odometerDue({ now, zone, lastCheck: now - ODOMETER_EVERY_MS })).toBe(true);
  });

  it('asks after the first shift of a new month in the driver’s time zone', () => {
    const lastCheck = at('2026-10-31T20:00:00Z'); // 16:00 on 31 October in New York
    expect(odometerDue({ now: at('2026-11-01T03:00:00Z'), zone, lastCheck })).toBe(false);
    expect(odometerDue({ now: at('2026-11-01T14:00:00Z'), zone, lastCheck })).toBe(true);
    expect(
      odometerDue({ now: at('2027-01-02T14:00:00Z'), zone, lastCheck: at('2026-12-30T14:00:00Z') }),
    ).toBe(true);
  });

  it('the last check is the newer of a reading on any shift and a dismissal', async () => {
    const { services, plain } = setup();
    const shifts = { lastOdometerAt: async () => 5_000 };
    expect(await lastOdometerCheck(shifts, plain, 3)).toBe(5_000);
    await markOdometerChecked(plain, 3, 9_000);
    expect(await lastOdometerCheck(shifts, plain, 3)).toBe(9_000);
    expect(await lastOdometerCheck({ lastOdometerAt: async () => 12_000 }, plain, 3)).toBe(12_000);
    expect(await lastOdometerCheck(services.shifts, plain, 4)).toBeNull();
  });
});

describe('odometer check on the phone', () => {
  const allowed = () =>
    new FakePermissions({ foregroundLocation: 'granted', backgroundLocation: 'granted' });

  async function runAndEnd(made: ReturnType<typeof setup>) {
    render(<App services={made.services} />);
    expect(screen.queryByLabelText('Odometer at start')).toBeNull();
    fireEvent.press(await screen.findByRole('button', { name: 'Start shift' }));
    expect(await screen.findByText('Shift running')).toBeTruthy();
    // Nothing about the odometer while the shift runs.
    expect(screen.queryByText(/odometer/i)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'End shift' }));
    fireEvent.press((await screen.findAllByRole('button', { name: 'End shift' })).at(-1)!);
    expect(await screen.findByText('Shift ended.')).toBeTruthy();
  }

  it('asks once after the shift; Not now closes it and the next shift is not asked', async () => {
    const made = setup(undefined, { paired: true, permissions: allowed() });
    await runAndEnd(made);
    expect(await screen.findByText('Odometer check')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('Odometer check')).toBeNull());
    const last = await lastOdometerCheck(made.services.shifts, made.plain, 3);
    expect(odometerDue({ now: Date.now(), zone, lastCheck: last })).toBe(false);
  });

  it('a saved reading becomes the end odometer of the shift just ended', async () => {
    const made = setup(undefined, { paired: true, permissions: allowed() });
    await runAndEnd(made);
    fireEvent.changeText(await screen.findByLabelText('Odometer reading'), '12a80');
    fireEvent.press(screen.getByRole('button', { name: 'Save reading' }));
    expect(await screen.findByText('That odometer reading is not a number.')).toBeTruthy();
    expect(screen.getByText('Odometer check')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Odometer reading'), '12480');
    fireEvent.press(screen.getByRole('button', { name: 'Save reading' }));
    expect(await screen.findByText('Odometer saved.')).toBeTruthy();
    expect(screen.queryByText('Odometer check')).toBeNull();
    // 12480 mi in metres (the test settings use miles).
    expect(await made.services.shifts.odometer(ID)).toMatchObject([
      { kind: 'shift_end', reading_m: Math.round(12480 * 1609.344) },
    ]);
  });

  it('is not asked when the last check is recent', async () => {
    const made = setup(undefined, { paired: true, permissions: allowed() });
    await markOdometerChecked(made.plain, 3, Date.now());
    await runAndEnd(made);
    await waitFor(() => expect(made.services.shift.current).toBeNull());
    expect(screen.queryByText('Odometer check')).toBeNull();
  });
});
