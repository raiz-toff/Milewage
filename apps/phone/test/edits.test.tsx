import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { MANUAL_TRIP_PURPOSE } from '../src/store/edits';
import { json, type Handler } from './support/mock';
import { drive, ID, server, setup } from './support/shiftKit';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const OVERRIDE = (key: string) => `PUT /shifts/${ID}/trip-overrides/${encodeURIComponent(key)}`;

async function endedShift(extra: Record<string, Handler> = {}) {
  const routes = server({
    [`POST /shifts/${ID}/end`]: () =>
      json(200, {
        id: 5,
        total_m: 444,
        active_m: 444,
        deadhead_m: 0,
        personal_m: 0,
        calc_version: 1,
      }),
    ...extra,
  });
  const ctx = setup(routes);
  await ctx.services.shift.start({ vehicleId: 3 });
  drive(ctx.tracker);
  ctx.clock.t = 100_000;
  await ctx.services.shift.end();
  await ctx.services.sender.sendNow();
  const [trip] = await ctx.services.shifts.trips(ID);
  return { ...ctx, trip: trip! };
}

describe('phone edits (15 section 8)', () => {
  it('reclassifying an auto trip shows at once, moves the split, and is sent as one override', async () => {
    const { services, routes, trip, clock, tracker } = await endedShift({
      [OVERRIDE(`${ID}:1000:active`)]: () => json(200, {}),
    });
    expect(trip.kind).toBe('active');
    const before = (await services.shifts.get(ID))!;
    const { total_m: total, active_m: active, deadhead_m: deadhead } = before;
    clock.t = 200_000;
    expect(
      await services.edits.editTrip(trip.trip_key, { kind: 'personal', purpose: 'errand' }),
    ).toEqual({ ok: true });
    await services.edits.editTrip(trip.trip_key, { kind: 'deadhead' }); // coalesced with the first
    const row = (await services.shifts.get(ID))!;
    expect(row).toMatchObject({ personal_m: 0, total_m: total });
    expect(row.deadhead_m).toBe((deadhead ?? 0) + trip.distance_m);
    expect(row.active_m).toBe((active ?? 0) - trip.distance_m);
    expect((await services.shifts.trips(ID))[0]).toMatchObject({
      kind: 'deadhead',
      purpose: 'errand',
      distance_m: trip.distance_m,
      sync_state: 'local',
    });

    await services.sender.sendNow();
    const sent = routes.calls.filter((c) => c.path.includes('trip-overrides'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      kind: 'deadhead',
      purpose: 'errand',
      edited_at: 200_000 + (tracker.gnssOffsetMs() ?? 0),
    });
  });

  it('edit times carry the GNSS offset when a fresh fix exists', async () => {
    const { services, tracker, trip, routes } = await endedShift({
      [OVERRIDE(`${ID}:1000:active`)]: () => json(200, {}),
    });
    jest.spyOn(tracker, 'gnssOffsetMs').mockReturnValue(-5_000);
    await services.edits.editTrip(trip.trip_key, { purpose: 'x' });
    await services.sender.sendNow();
    expect(routes.calls.find((c) => c.path.includes('trip-overrides'))!.body).toMatchObject({
      edited_at: 100_000 - 5_000,
    });
  });

  it('refuses what 07 forbids: unknown trip, bad values, finalized shifts; the distance is never touched', async () => {
    const { services, trip, plain } = await endedShift();
    expect(await services.edits.editTrip('nope', { kind: 'active' })).toEqual({
      ok: false,
      reason: 'no_trip',
    });
    expect(await services.edits.editTrip(trip.trip_key, { purpose: 'x'.repeat(201) })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(
      await services.edits.addManualTrip(ID, {
        kind: 'active',
        startedAt: 5,
        endedAt: 1,
        distanceM: 10,
        purpose: '',
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(await services.edits.setOdometer('missing', 'shift_end', 5)).toEqual({
      ok: false,
      reason: 'no_shift',
    });
    await services.shifts.applyEnd(
      ID,
      { id: 5, total_m: 444, active_m: 444, deadhead_m: 0, personal_m: 0, calc_version: 1 },
      null,
    );
    // Mark finalized the way a pull would.
    (
      services.shifts as unknown as {
        db: { runAsync(s: string, ...p: string[]): Promise<unknown> };
      }
    ).db.runAsync("UPDATE shifts SET status = 'finalized' WHERE client_id = ?", ID);
    expect(await services.edits.editTrip(trip.trip_key, { kind: 'personal' })).toEqual({
      ok: false,
      reason: 'finalized',
    });
    expect((await services.shifts.trips(ID))[0]!.distance_m).toBe(trip.distance_m);
    void plain;
  });

  it('a manual trip is stored, counted, keyed by a lower-case id and sent as an idempotent PUT', async () => {
    const id = 'ABCDEF12-1111-4111-8111-111111111111';
    const { services, routes } = await endedShift({
      [`PUT /shifts/${ID}/trips/${id.toLowerCase()}`]: () => json(200, {}),
    });
    const before = (await services.shifts.get(ID))!.total_m!;
    const ctxIds = services as unknown as { edits: { d: { newId?: () => string } } };
    ctxIds.edits.d.newId = () => id;
    await services.edits.addManualTrip(ID, {
      kind: 'active',
      startedAt: 10,
      endedAt: 20,
      distanceM: 1500,
      purpose: 'cash job',
    });
    const trips = await services.shifts.trips(ID);
    expect(trips.find((t) => t.source === 'manual')).toMatchObject({
      trip_key: id.toLowerCase(),
      distance_m: 1500,
      kind: 'active',
    });
    expect((await services.shifts.get(ID))!.total_m).toBe(before + 1500);
    await services.sender.sendNow();
    const put = routes.calls.find((c) => c.method === 'PUT' && c.path.endsWith(id.toLowerCase()))!;
    expect(put.body).toMatchObject({
      kind: 'active',
      distance_m: 1500,
      purpose: 'cash job',
      started_at: 10,
      ended_at: 20,
    });
  });

  it('odometer and notes edits are coalesced and sent; the newest value wins in the queue', async () => {
    const { services, routes } = await endedShift({
      [`PATCH /shifts/${ID}`]: () => json(200, {}),
    });
    await services.edits.setOdometer(ID, 'shift_end', 70_000);
    await services.edits.setOdometer(ID, 'shift_end', 71_000);
    await services.edits.setNotes(ID, 'rain');
    expect(await services.shifts.odometer(ID)).toMatchObject([
      { kind: 'shift_end', reading_m: 71_000 },
    ]);
    await services.sender.sendNow();
    const odo = routes.calls.filter((c) => c.path.endsWith('odometer/shift_end'));
    expect(odo.at(-1)!.body).toMatchObject({ reading_m: 71_000 });
    expect(routes.calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ notes: 'rain' });
  });

  /** A trip write as the server takes it: a purpose of 1 to 200 characters (`TripCreate`). */
  const strict = (r: { body: unknown }) => {
    const purpose = (r.body as { purpose?: string }).purpose ?? '';
    return purpose.length >= 1 && purpose.length <= 200
      ? json(200, {})
      : json(422, { code: 'validation_failed', retryable: false });
  };

  it('an empty purpose is refused on the phone, before it is queued for a server that would refuse it', async () => {
    const { services, routes, trip } = await endedShift({
      [OVERRIDE(`${ID}:1000:active`)]: () => json(200, {}),
    });
    for (const purpose of ['', '   ']) {
      expect(await services.edits.editTrip(trip.trip_key, { purpose })).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(
        await services.edits.addManualTrip(ID, {
          kind: 'active',
          startedAt: 10,
          endedAt: 20,
          distanceM: 100,
          purpose,
        }),
      ).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(await services.shifts.trips(ID)).toEqual([trip]);
    expect(await services.sender.sendNow()).toBe(true);
    expect(routes.calls.filter((c) => c.path.includes('/trip'))).toEqual([]);
    expect((await services.sender.status()).color).toBe('green');
  });

  it('"Add trip" on the detail screen sends a purpose the server takes; the shift stays on the server', async () => {
    // The phone's ids are fixed in the test kit, so the manual trip's key is the shift's id.
    const ctx = await endedShift({ [`PUT /shifts/${ID}/trips/${ID}`]: strict });
    const { routes } = ctx;
    render(<App services={ctx.services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    fireEvent.press(await screen.findByRole('button', { name: /^Shift / }));
    fireEvent.changeText(await screen.findByLabelText('Trip distance'), '1.5');
    fireEvent.press(screen.getByRole('button', { name: 'Add trip' }));
    expect(await screen.findByText('Trip added.')).toBeTruthy();
    const manual = (await ctx.services.shifts.trips(ID)).find((t) => t.source === 'manual')!;
    expect(manual.purpose).toBe(MANUAL_TRIP_PURPOSE);
    await ctx.services.sender.sendNow();
    const put = routes.calls.find((c) => c.path === `/shifts/${ID}/trips/${manual.trip_key}`)!;
    expect(put.body).toMatchObject({ purpose: 'Business driving', distance_m: manual.distance_m });
    expect((await ctx.services.shifts.get(ID))!.sync_state).not.toBe('needs_attention');
    expect((await ctx.services.sender.status()).color).toBe('green');
  });

  it('the trip row on the detail screen changes type with one tap', async () => {
    const { services, trip } = await endedShift({
      [OVERRIDE(`${ID}:1000:active`)]: () => json(200, {}),
    });
    render(<App services={services} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Shifts' }));
    fireEvent.press(await screen.findByRole('button', { name: /^Shift / }));
    fireEvent.press(await screen.findByRole('button', { name: /Change type of trip/ }));
    expect(await screen.findByRole('button', { name: /Change type of trip/ })).toBeTruthy();
    expect(await screen.findByText(/change to Personal/)).toBeTruthy();
    expect((await services.shifts.trips(ID))[0]!.trip_key).toBe(trip.trip_key);
    expect((await services.shifts.trips(ID))[0]!.kind).toBe('deadhead');
  });
});
