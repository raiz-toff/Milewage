import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ShiftInput } from '@milewage/track-engine';
import { App } from '../src/App';
import fixtures from '../src/conformance/fixtures.json';
import { totalsCaption } from '../src/format';
import { json } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const fx = (fixtures.inputs as unknown as Record<string, ShiftInput>).scenario_delivery_run!;

/** A finished shift recorded with the network down. */
async function offlineShift(over: Record<string, unknown> = {}) {
  const ctx = setup(server({ 'POST /shifts': () => json(503, { code: 'x', retryable: true }) }), {
    paired: true,
    ...over,
  });
  ctx.clock.t = fx.startedAt;
  await ctx.services.shift.start({ vehicleId: 3 });
  for (const f of fx.fixes) {
    ctx.tracker.emit({ recordedAt: f.recordedAt, latE7: f.latE7, lonE7: f.lonE7, accuracyM: 5 });
  }
  ctx.clock.t = fx.endedAt;
  await ctx.services.shift.end();
  return ctx;
}

describe('shift list and detail (work offline)', () => {
  it('lists the shift with its total and who calculated it, then opens the detail', async () => {
    const { services } = await offlineShift();
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    expect(await screen.findByText('2023-11-14')).toBeTruthy();
    expect(screen.getByText('3.9 mi')).toBeTruthy();
    expect(screen.getByText(/Calculated on phone · On phone only/)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Shift 2023-11-14' }));
    expect((await screen.findByLabelText('Total')).props.children).toBe('3.9 mi');
    expect(screen.getByText(/Active 1\.2 mi · Deadhead 2\.7 mi \(estimated\)/)).toBeTruthy();
    expect(screen.getByLabelText('Route')).toBeTruthy();
    // Three trips, each marked estimated because the shift used the stops segmenter.
    expect(screen.getAllByText(/\(estimated\)/).length).toBe(1 + 3);
  });

  it('shows "Confirmed by server" once the server answered, and an empty list message otherwise', async () => {
    const empty = setup();
    const view = render(<App services={empty.services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    expect(await screen.findByText('No shifts yet.')).toBeTruthy();
    view.unmount();

    const { services } = await offlineShift();
    await services.shifts.applyEnd(
      ID,
      { id: 9, total_m: 6300, active_m: 2000, deadhead_m: 4300, personal_m: 0, calc_version: 1 },
      { status: 'match', server_total_m: 6300, diff_m: 0, reasons: [] },
    );
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    expect(await screen.findByText(/Confirmed by server · On server/)).toBeTruthy();
  });

  it('captions: empty totals wait for the server', () => {
    expect(totalsCaption({ total_m: null, calc_source: 'phone' })).toBe(
      'Totals will appear once it is sent to the server',
    );
  });
});
