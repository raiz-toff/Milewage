import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { App } from '../src/App';
import { FakePermissions } from '../src/permissions/fake';
import {
  advance,
  canStartShift,
  describeLadder,
  initialLadder,
  refresh,
  trackingMode,
  UNKNOWN_SNAPSHOT,
} from '../src/permissions/ladder';
import { FakeTracker } from '../src/tracker/fake';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

describe('ladder state machine', () => {
  it('starts at the disclosure and offers no OS prompt before it', () => {
    const view = describeLadder(initialLadder());
    expect(view.next).toBe('disclosure');
    expect(view.steps.find((s) => s.id === 'foreground')?.state).toBe('pending');
  });

  it('walks disclosure, foreground, background, activity, notifications, battery in order', async () => {
    const port = new FakePermissions();
    let state = initialLadder();
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { next } = describeLadder(state);
      if (!next) break;
      seen.push(next);
      state = await advance(port, state);
    }
    expect(seen).toEqual([
      'disclosure',
      'foreground',
      'background',
      'activity',
      'notifications',
      'battery',
    ]);
    expect(port.requests).toEqual(['foreground', 'background', 'activity', 'notifications']);
    expect(describeLadder(state).mode).toBe('full');
    expect(describeLadder(state).warnings).toEqual([]);
  });

  it('never asks for background before foreground is granted', async () => {
    const port = new FakePermissions();
    port.answers.foreground = 'denied';
    let state = await advance(port, initialLadder());
    state = await advance(port, state);
    const view = describeLadder(state);
    expect(port.requests).toEqual(['foreground']);
    expect(view.steps.find((s) => s.id === 'background')?.state).toBe('pending');
    expect(canStartShift(state)).toBe(false);
    expect(view.warnings.join(' ')).toMatch(/cannot record miles/);
  });

  it('while-using only: tracking mode and a warning, shift still allowed', async () => {
    const port = new FakePermissions({ foregroundLocation: 'granted' });
    port.answers.background = 'denied';
    let state = initialLadder(await port.snapshot());
    state = await advance(port, state); // disclosure
    state = await advance(port, state); // background
    const view = describeLadder(state);
    expect(view.mode).toBe('while_using');
    expect(canStartShift(state)).toBe(true);
    expect(view.warnings.join(' ')).toMatch(/while using the app/);
  });

  it('a blocked step does not hold the ladder', () => {
    const state = {
      ...initialLadder({
        ...UNKNOWN_SNAPSHOT,
        foregroundLocation: 'granted',
        backgroundLocation: 'blocked',
      }),
      disclosureAccepted: true,
    };
    const view = describeLadder(state);
    expect(view.steps.find((s) => s.id === 'background')?.state).toBe('blocked');
    expect(view.next).toBe('activity');
    expect(view.warnings.join(' ')).toMatch(/system settings/);
  });

  it('location services off means none, even with permission', () => {
    expect(
      trackingMode({
        ...UNKNOWN_SNAPSHOT,
        foregroundLocation: 'granted',
        locationServicesEnabled: false,
      }),
    ).toBe('none');
  });

  it('refresh picks up a change made in system settings', async () => {
    const port = new FakePermissions();
    const state = initialLadder(await port.snapshot());
    port.snap = { ...port.snap, foregroundLocation: 'granted', backgroundLocation: 'granted' };
    expect(describeLadder(await refresh(port, state)).mode).toBe('full');
  });
});

describe('permissions screen', () => {
  it('shows the disclosure first, then prompts and opens battery settings', async () => {
    const permissions = new FakePermissions();
    const tracker = new FakeTracker();
    render(<App services={{ permissions, tracker }} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Permissions' }));
    expect(await screen.findByText(/including when the app is closed/)).toBeTruthy();
    expect(permissions.requests).toEqual([]);

    fireEvent.press(await screen.findByRole('button', { name: 'I understand' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Allow location' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Allow all the time' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Allow activity recognition' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Allow notifications' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Open battery settings' }));
    await waitFor(() => expect(tracker.batterySettingsOpened).toBe(1));
    expect(permissions.requests).toEqual(['foreground', 'background', 'activity', 'notifications']);
  });
});
