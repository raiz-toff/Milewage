import type { ShiftInput } from '@milewage/track-engine';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import fixtures from '../src/conformance/fixtures.json';
import { json } from './support/mock';
import { SETTINGS } from './support/mock';
import { server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const fx = (fixtures.inputs as unknown as Record<string, ShiftInput>).scenario_delivery_run!;

async function recorded(paired: object | boolean = true) {
  const ctx = setup(server({ 'POST /shifts': () => json(503, { code: 'x', retryable: true }) }), {
    paired,
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

/** The detail screen of the only shift, with the cached settings changed after it was recorded. */
async function openDetail(ctx: Awaited<ReturnType<typeof recorded>>, settings?: object) {
  if (settings) {
    ctx.plain.data.set('pairing.settings', JSON.stringify({ ...SETTINGS, ...settings }));
  }
  render(<App services={ctx.services} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
  fireEvent.press(await screen.findByRole('button', { name: /^Shift / }));
  await screen.findByLabelText('Total');
}

const split = () => screen.queryByText(/Active .* · Deadhead .*\(estimated\)/);
const stops = () => screen.queryByText(/Stops \(estimated/);

describe('read-only stops and the estimated split follow stops_enabled (M6.5)', () => {
  it('on: the split is marked estimated and the detected stops are listed, read only', async () => {
    await openDetail(await recorded());
    expect(split()).toBeTruthy();
    expect(stops()).toBeTruthy();
    expect(screen.getAllByText(/min · .* confidence/)).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /label/i })).toBeNull();
  });

  it('stops_enabled off now: one business total, no split, no stops, trips without a type', async () => {
    await openDetail(await recorded(), { stops_enabled: false });
    expect(split()).toBeNull();
    expect(stops()).toBeNull();
    expect(screen.getByLabelText('Total').props.children).toBe('3.9 mi');
    expect(screen.queryByText(/Deadhead \d/)).toBeNull();
  });

  it('the stops module off on the server hides them too', async () => {
    await openDetail(await recorded(), { modules: { tracking: true, stops: false } });
    expect(split()).toBeNull();
    expect(stops()).toBeNull();
  });

  it('a shift recorded while the setting was off stays one total even after it is turned on', async () => {
    const ctx = await recorded({ stops_enabled: false });
    expect((await ctx.services.shifts.get('11111111-1111-4111-8111-111111111111'))!.segmenter).toBe(
      'whole_shift',
    );
    await openDetail(ctx, { stops_enabled: true });
    expect(split()).toBeNull();
    expect(stops()).toBeNull();
  });
});
