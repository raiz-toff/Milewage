import { algorithmVersion, processShift, type ShiftInput } from '@milewage/track-engine';
import fixtures from '../src/conformance/fixtures.json';
import { toFix } from '../src/shift/feed';
import { localDate } from '../src/store/shiftStore';
import { drive, ID, setup, server } from './support/shiftKit';
import { json, problem } from './support/mock';
import { openNodeAppDb } from './support/nodeSql';

const input = (name: string) =>
  (fixtures.inputs as unknown as Record<string, ShiftInput>)[name] as ShiftInput;
const expected = (name: string) =>
  JSON.parse((fixtures.expected as Record<string, string>)[name]!) as ReturnType<
    typeof processShift
  >;

/** Plays a fixture through the phone: start, the fixes, end, with the network down. */
async function ride(name: string, routes = server(), over: Parameters<typeof setup>[1] = {}) {
  const fx = input(name);
  const ctx = setup(routes, { paired: true, ...over });
  ctx.clock.t = fx.startedAt;
  await ctx.services.shift.start({ vehicleId: 3 });
  for (const f of fx.fixes) {
    ctx.tracker.emit({
      recordedAt: f.recordedAt,
      latE7: f.latE7,
      lonE7: f.lonE7,
      accuracyM: f.accuracyM,
    });
  }
  ctx.clock.t = fx.endedAt;
  return ctx;
}

const down = () =>
  server({
    'POST /shifts': () => problem(503, 'unavailable', true),
    'POST /telemetry/batch': () => problem(503, 'unavailable', true),
  });

describe('shift end on the phone (15 section 5)', () => {
  it('offline: stores the totals, trips, stops and route the shared engine gives for a known ride', async () => {
    const { services } = await ride('scenario_delivery_run', down());
    expect(await services.shift.end({ odometerEndM: 90_000 })).toEqual({ ok: true, sent: false });

    const want = expected('scenario_delivery_run');
    const row = (await services.shifts.get(ID))!;
    expect(row).toMatchObject({
      status: 'ended',
      calc_source: 'phone',
      recon_status: 'pending',
      sync_state: 'local',
      segmenter: 'stops',
      total_m: want.totals.totalM,
      active_m: want.totals.activeM,
      deadhead_m: want.totals.deadheadM,
      personal_m: want.totals.personalM,
      calc_version: algorithmVersion,
      point_count: input('scenario_delivery_run').fixes.length,
    });
    expect(row.total_m).toBe(6300);
    expect(JSON.parse(row.route_geojson!).type).toBe('LineString');

    const trips = await services.shifts.trips(ID);
    expect(trips.map((t) => [t.kind, t.distance_m, t.source])).toEqual(
      want.trips.map((t) => [t.kind, t.distanceM, 'auto']),
    );
    expect((await services.shifts.stops(ID)).map((s) => s.stop_key)).toEqual(
      want.stops.map((s) => s.stopKey.replace(want.stops[0]!.stopKey.split(':')[0]!, ID)),
    );
    expect(await services.shifts.odometer(ID)).toMatchObject([
      { kind: 'shift_end', reading_m: 90_000 },
    ]);
  });

  it('queues create, odometer and end in order, with the manifest and phone result', async () => {
    const { services, tracker } = await ride('ride_straight', down());
    await services.shift.setOdometerStart(50_000);
    await services.shift.end({ odometerEndM: 55_000 });
    const items = await services.outbox.pending();
    expect(items.map((i) => [i.kind, i.entityKey])).toEqual([
      ['shift.create', ID],
      ['odometer.put', `${ID}:shift_start`],
      ['odometer.put', `${ID}:shift_end`],
      ['shift.end', ID],
    ]);
    const end = items[3]!.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rows = tracker.readByShift(ID, 0, 1000);
    const again = processShift({
      shiftClientId: ID,
      startedAt: input('ride_straight').startedAt,
      endedAt: input('ride_straight').endedAt,
      fixes: rows.map(toFix),
      segmenter: 'stops',
    });
    expect(end.manifest.point_count).toBe(rows.length);
    expect(end.phone_result).toMatchObject({
      total_m: 5000,
      input_digest: again.inputDigest,
      calc_version: algorithmVersion,
    });
  });

  it('whole_shift segmenter stores no stops; stops stay empty', async () => {
    const { services } = await ride('scenario_delivery_run', down(), {
      paired: { stops_enabled: false },
    });
    await services.shift.end();
    expect((await services.shifts.get(ID))!.segmenter).toBe('whole_shift');
    expect(await services.shifts.stops(ID)).toEqual([]);
    expect((await services.shifts.trips(ID)).length).toBeGreaterThan(0);
  });

  it('an engine failure still ends and queues the shift; totals stay empty for the server to fill', async () => {
    const { services, tracker } = await ride('ride_straight', down());
    jest.spyOn(tracker, 'readByShift').mockImplementation(() => {
      throw new Error('boom');
    });
    await services.shift.end();
    expect(await services.shifts.get(ID)).toMatchObject({
      status: 'ended',
      total_m: null,
      recon_status: 'pending',
    });
    expect((await services.outbox.pending()).map((i) => i.kind)).toEqual([
      'shift.create',
      'shift.end',
    ]);
  });

  it('with the server back: its numbers replace the phone label and the shift is on the server', async () => {
    const routes = server({
      [`POST /shifts/${ID}/end`]: () =>
        json(200, {
          id: 41,
          total_m: 5000,
          active_m: 5000,
          deadhead_m: 0,
          personal_m: 0,
          calc_version: algorithmVersion,
          recon: { status: 'match', server_total_m: 5000, diff_m: 0, reasons: [] },
        }),
    });
    const { services } = await ride('ride_straight', routes);
    expect(await services.shift.end()).toEqual({ ok: true, sent: true });
    expect(await services.shifts.get(ID)).toMatchObject({
      server_id: 41,
      calc_source: 'server',
      recon_status: 'match',
      sync_state: 'on_server',
      server_total_m: 5000,
    });
    expect((await services.outbox.counts()).pending).toBe(0);
  });

  it('a different server total is shown as the server number and keeps the phone number in the conflict log', async () => {
    const routes = server({
      [`POST /shifts/${ID}/end`]: () =>
        json(200, {
          id: 41,
          total_m: 4900,
          active_m: 4900,
          deadhead_m: 0,
          personal_m: 0,
          calc_version: algorithmVersion,
          recon: {
            status: 'differs',
            server_total_m: 4900,
            diff_m: -100,
            reasons: ['points_missing'],
          },
        }),
    });
    const { services } = await ride('ride_straight', routes);
    await services.shift.end();
    const row = (await services.shifts.get(ID))!;
    expect(row).toMatchObject({ total_m: 4900, calc_source: 'server', recon_status: 'differs' });
    expect(JSON.parse(row.recon_reasons!)).toEqual(['points_missing']);
  });

  it('a queued create the server refuses parks the shift as needing attention', async () => {
    let calls = 0;
    const routes = server({
      // Offline when the shift starts; by the time the queue runs the server refuses it.
      'POST /shifts': () =>
        ++calls === 1 ? problem(503, 'x', true) : problem(409, 'shift_already_active'),
    });
    const { services } = await ride('ride_straight', routes);
    await services.shift.end();
    expect((await services.outbox.parked()).map((i) => i.kind)).toContain('shift.create');
    expect((await services.shifts.get(ID))!.sync_state).toBe('needs_attention');
    expect(await services.shift.isParked(ID)).toBe(true);
  });

  it('a kill between "End shift" and the hand-off completes on the next start, without a second shift.end', async () => {
    const db = openNodeAppDb();
    const first = setup(down(), { paired: true, openAppDb: async () => db });
    await first.services.shift.start({ vehicleId: 3 });
    drive(first.tracker);
    jest.spyOn(first.services.shifts, 'finish').mockRejectedValueOnce(new Error('killed'));
    await expect(first.services.shift.end()).rejects.toThrow('killed');
    expect((await first.services.shifts.get(ID))!.status).toBe('active');

    const second = setup(down(), { paired: true, openAppDb: async () => db });
    second.plain.data.set('shift.active', first.plain.data.get('shift.active')!);
    second.tracker.emit({ recordedAt: 0 });
    await second.services.shift.load();
    expect(second.services.shift.current).toBeNull();
    expect((await second.services.shifts.get(ID))!.status).toBe('ended');
    const kinds = (await second.services.outbox.pending()).map((i) => i.kind);
    expect(kinds.filter((k) => k === 'shift.end')).toHaveLength(1);
  });

  it('local dates use the instance time zone, not the device zone', () => {
    const at = Date.UTC(2026, 10, 2, 3, 30); // 03:30 UTC on 2 November
    expect(localDate(at, 'America/New_York')).toBe('2026-11-01');
    expect(localDate(at, 'Asia/Tokyo')).toBe('2026-11-02');
    expect(localDate(at, 'Not/AZone')).toBe('2026-11-02');
  });
});
