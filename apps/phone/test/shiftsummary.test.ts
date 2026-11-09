import { diagKinds, validateEvent } from '@milewage/shared';
import {
  batteryPort,
  buildShiftSummary,
  type BatteryReading,
} from '../src/diagnostics/shiftSummary';
import type { LocalRun } from '../src/shift/endPayload';
import { nativeBattery } from '../src/tracker/native';
import { drive, ID, server, setup } from './support/shiftKit';

/** Stands in for the tracker module; each test sets what the phone answers. */
const mockNative: { battery?: () => BatteryReading | null } = {};
jest.mock('../native/comma-tracker', () => ({ __esModule: true, default: mockNative }));

/** A battery that answers the queued readings in turn, then null. */
function battery(...readings: (BatteryReading | null)[]) {
  return batteryPort(async () => readings.shift() ?? null);
}

/** Starts, drives five fixes, ends one hour after the start. */
async function shift(over: Parameters<typeof setup>[1] = {}) {
  const ctx = setup(server(), { paired: true, ...over });
  await ctx.services.shift.start({ vehicleId: 3 });
  drive(ctx.tracker, ctx.clock.t);
  ctx.clock.t += 3_600_000;
  await ctx.services.shift.end();
  const sums = ctx.services.diagnostics.snapshot().filter((e) => e.kind === 'shift.summary');
  return { ...ctx, sums };
}

describe('shift.summary (16 section 3.2)', () => {
  it('is recorded once at shift end with the battery, counts and the shift id', async () => {
    const { sums, plain } = await shift({
      battery: battery({ level: 80, charging: false }, { level: 71, charging: false }),
    });
    expect(sums).toHaveLength(1);
    const ev = sums[0]!;
    expect(ev).toMatchObject({ shift: ID, src: 'phone_js', level: 'basic' });
    expect(ev.data).toEqual({
      duration_s: 3600,
      battery_start: 80,
      battery_end: 71,
      charging_seen: false,
      fixes: 5,
      gap_count: 0,
      service_restarts: 0,
      engine_ms: 0,
      capture: false,
    });
    // Exactly the allowlisted fields, valid against the shared schema, and kept on disk.
    expect(Object.keys(ev.data).sort()).toEqual(
      Object.keys(diagKinds['shift.summary'].data).sort(),
    );
    expect(validateEvent(ev).ok).toBe(true);
    expect(await plain.get('diag.ring')).toContain('"shift.summary"');
  });

  it('charging at the start or the end counts as charging seen', async () => {
    const { sums } = await shift({
      battery: battery({ level: 40, charging: true }, { level: 60, charging: false }),
    });
    expect(sums[0]!.data).toMatchObject({
      battery_start: 40,
      battery_end: 60,
      charging_seen: true,
    });
  });

  it('is not sent when the battery cannot be read at the start or at the end', async () => {
    expect((await shift()).sums).toEqual([]);
    expect((await shift({ battery: battery(null, { level: 50, charging: false }) })).sums).toEqual(
      [],
    );
    expect((await shift({ battery: battery({ level: 50, charging: false }, null) })).sums).toEqual(
      [],
    );
    const broken = batteryPort(async () => {
      throw new Error('no battery service');
    });
    const ended = await shift({ battery: broken });
    expect(ended.sums).toEqual([]);
    expect((await ended.services.shifts.get(ID))?.status).toBe('ended');
  });

  it('counts each gap once, a large gap included', () => {
    const flag = (code: string) => ({ code, at: 0, detail: '' });
    const local = {
      result: { flags: ['gap_counted', 'gap_large', 'gap_dropped', 'low_fix_density'].map(flag) },
      manifest: { firstSeq: 1, lastSeq: 9, pointCount: 9 },
      phoneResult: {},
    } as unknown as LocalRun;
    const s = buildShiftSummary({
      startedAt: 0,
      endedAt: 90_000,
      start: { level: 90, charging: false },
      end: { level: 88, charging: false },
      local,
      engineMs: 12.4,
    });
    expect(s).toMatchObject({ gap_count: 2, fixes: 9, duration_s: 90, engine_ms: 12 });
  });
});

describe('battery reader', () => {
  it('reads the tracker module, and null on a build without the reader or for nonsense', async () => {
    const port = batteryPort(nativeBattery);
    mockNative.battery = () => ({ level: 63, charging: true });
    expect(await port.read()).toEqual({ level: 63, charging: true });
    mockNative.battery = () => ({ level: -1, charging: false });
    expect(await port.read()).toBeNull();
    mockNative.battery = () => null;
    expect(await port.read()).toBeNull();
    delete mockNative.battery;
    expect(await port.read()).toBeNull();
  });
});
