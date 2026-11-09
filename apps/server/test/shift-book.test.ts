import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createArchiveRepository,
  createProcessingRepository,
  createShiftRepository,
  createTelemetryRepository,
} from '../src/db';
import { createDriverContexts } from '../src/driver-context';
import {
  createShiftBook,
  DEVICE_READ_WINDOW_MS,
  type ShiftBook,
} from '../src/processing/shift-book';
import type { Principal } from '../src/routes/util';
import { ride, SHIFT } from './rides';
import { harness, type Harness } from './support';

const DAY = 24 * 3_600_000;
const web: Principal = { kind: 'session', userId: 1, idHash: 'x' };
const phone: Principal = { kind: 'device', userId: 1, deviceId: 1 };

let h: Harness;
let heard: [string, Record<string, unknown>][];
let modules: { tracking: boolean; stops: boolean };
let book: ShiftBook;

beforeEach(async () => {
  h = harness();
  const { cookie } = await h.signUp();
  await h.call('POST', '/vehicles', { name: 'Civic', kind: 'car' }, { cookie });
  await h.pair(cookie);
  heard = [];
  modules = { tracking: true, stops: true };
  book = createShiftBook({
    db: h.db,
    now: () => h.clock.t,
    drivers: createDriverContexts({
      db: h.db,
      now: () => h.clock.t,
      stopsModule: () => modules.stops,
    }),
    emit: ((event: string, payload: Record<string, unknown>) => {
      heard.push([event, payload]);
    }) as never,
    trackingModule: () => modules.tracking,
    stopsModule: () => modules.stops,
  });
});
afterEach(() => h.close());

const events = () => heard.map(([e]) => e);
const n = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const start = (i: number, startedAt: number, p: Principal = phone) =>
  book.start(p, { clientId: n(i), vehicleId: 1, startedAt });
/** A shift with the ride's points, ended by the phone. */
function rideShift(i = 1) {
  const t0 = h.clock.t - 2 * 3_600_000;
  const row = book.start(phone, { clientId: i === 1 ? SHIFT : n(i), vehicleId: 1, startedAt: t0 });
  createTelemetryRepository(h.db).insert(
    ride(t0).map((f) => ({
      userId: 1,
      deviceId: 1,
      shiftId: row.id,
      ...f,
      speedDmps: null,
      bearingDeg: null,
      altitudeM: null,
    })),
  );
  return book.end(phone, row, { endedAt: t0 + 313 * 5000 });
}
const manualTrip = (shiftId: number, kind: 'active' | 'personal', m: number) =>
  createProcessingRepository(h.db).insertTrip({
    userId: 1,
    shiftId,
    tripKey: n(900 + m),
    clientId: n(900 + m),
    kind,
    originalKind: 'active',
    source: 'manual',
    startedAt: h.clock.t - 3_600_000,
    endedAt: h.clock.t - 3_000_000,
    distanceM: m,
    purpose: 'Typed',
    editedAt: h.clock.t,
    startLatE7: null,
    startLonE7: null,
    endLatE7: null,
    endLonE7: null,
  });
const archive = (shiftId: number) =>
  createArchiveRepository(h.db).replacePoints({
    shiftId,
    userId: 1,
    geometry: JSON.stringify({ type: 'LineString', coordinates: [], properties: { times: [] } }),
    rawPointCount: createProcessingRepository(h.db).countPoints(shiftId),
    keptPointCount: 0,
    toleranceM: 5,
    archivedAt: h.clock.t,
  });

describe('the read window: a device reads 14 days, a web session everything', () => {
  test('started, or written to by a device, inside the window', () => {
    const old = start(1, h.clock.t - 20 * DAY, web);
    book.end(web, old, { endedAt: h.clock.t - 20 * DAY + 3_600_000 });
    expect(book.since(web)).toBeUndefined();
    expect(book.since(phone)).toBe(h.clock.t - DEVICE_READ_WINDOW_MS);
    expect(book.find(web, String(old.id)).id).toBe(old.id);
    expect(() => book.find(phone, String(old.id))).toThrow(
      expect.objectContaining({ code: 'shift_not_found' }),
    );
    expect(book.list(phone, { limit: 10 })).toEqual([]);
    // A web write does not bring it into the window; a device write does.
    book.touch(web, old);
    expect(() => book.find(phone, old.clientId)).toThrow();
    book.touch(phone, old);
    expect(book.find(phone, old.clientId).id).toBe(old.id);
    expect(book.list(phone, { limit: 10 }).map((s) => s.id)).toEqual([old.id]);
  });

  test('editable refuses a finalized shift, reading does not', () => {
    const row = rideShift();
    book.finalize(row);
    expect(book.find(phone, SHIFT).status).toBe('finalized');
    expect(() => book.find(phone, SHIFT, { editable: true })).toThrow(
      expect.objectContaining({ code: 'shift_finalized' }),
    );
  });
});

describe('recording and recomputing', () => {
  test('a shift start takes the local date and segmenter from the driver now', async () => {
    const a = start(1, Date.parse('2027-01-15T05:30:00Z')); // 23:30 the evening before in Chicago
    expect([a.localDate, a.segmenter, a.status]).toEqual(['2027-01-14', 'stops', 'active']);
    expect(heard).toEqual([['shift.started', { shiftId: String(a.id) }]]);
  });

  test('the end runs the engine and announces it; stops follow the stops module', () => {
    const ended = rideShift();
    expect(ended.status).toBe('ended');
    expect(ended.totalM).toBeGreaterThan(0);
    expect(ended.calculatedAt).toBe(h.clock.t);
    expect(events()).toEqual([
      'shift.started',
      'engine.ran',
      'shift.reconciled',
      'shift.ended',
      'stops.derived',
    ]);
  });

  test('with tracking off the end only records the time; a recalculation adds up the trips', () => {
    modules.tracking = false;
    const row = start(1, h.clock.t - 3_600_000);
    const ended = book.end(phone, row, { endedAt: h.clock.t - 60_000 });
    expect([ended.status, ended.totalM]).toEqual(['ended', null]);
    manualTrip(row.id, 'active', 5000);
    manualTrip(row.id, 'personal', 2000);
    heard = [];
    const again = book.recompute(web, ended, { cause: 'recalc' });
    expect([again.totalM, again.activeM, again.personalM]).toEqual([7000, 5000, 2000]);
    expect(events()).toEqual(['shift.updated']); // no engine ran
  });

  test('a trip change on a running shift waits for the end, and is still announced', () => {
    const row = start(1, h.clock.t - 3_600_000);
    const trip = manualTrip(row.id, 'active', 5000);
    heard = [];
    const same = book.recompute(phone, row, { cause: 'trip', tripId: trip.id });
    expect(same.totalM).toBeNull();
    expect(heard).toEqual([
      ['trip.updated', { shiftId: String(row.id), tripId: String(trip.id) }],
      ['shift.updated', { shiftId: String(row.id) }],
    ]);
  });

  test('every engine run is announced the same way, whatever caused it', () => {
    const row = rideShift();
    const trip = manualTrip(row.id, 'active', 5000);
    for (const change of [
      { cause: 'trip', tripId: trip.id },
      { cause: 'override' },
      { cause: 'label' },
      { cause: 'recalc' },
    ] as const) {
      heard = [];
      const saved = book.recompute(web, row, change);
      expect(saved.totalM).toBe(row.totalM! + 5000);
      const ran = heard.find(([e]) => e === 'engine.ran')![1];
      expect(ran.reason).toBe(change.cause === 'label' ? 'label' : 'recalc');
      expect(events().slice(-2)).toEqual(['shift.updated', 'stops.derived']);
    }
    modules.stops = false;
    heard = [];
    book.recompute(web, row, { cause: 'recalc' });
    expect(events()).not.toContain('stops.derived');
  });

  test('archived points: a trip change is added up, the engine is refused', () => {
    const row = rideShift();
    archive(row.id);
    const trip = manualTrip(row.id, 'active', 5000);
    heard = [];
    const saved = book.recompute(web, row, { cause: 'trip', tripId: trip.id });
    expect(saved.totalM).toBe(row.totalM! + 5000);
    expect(events()).toEqual(['trip.updated', 'shift.updated']);
    for (const cause of ['recalc', 'label'] as const) {
      expect(() => book.recompute(web, row, { cause })).toThrow(
        expect.objectContaining({ code: 'not_recomputable' }),
      );
    }
    expect(() => book.needsEngine(row)).toThrow(
      expect.objectContaining({ code: 'not_recomputable' }),
    );
  });

  test('a device write keeps the shift in its window', () => {
    const row = rideShift();
    h.clock.t += 20 * DAY;
    expect(() => book.find(phone, SHIFT)).toThrow();
    book.recompute(phone, book.find(web, SHIFT), { cause: 'override' });
    expect(book.find(phone, SHIFT).id).toBe(row.id);
  });

  test('late points recompute an ended shift only', () => {
    const row = rideShift();
    const running = start(2, h.clock.t - 60_000);
    expect(book.latePoints(running.id)).toBeUndefined();
    heard = [];
    expect(book.latePoints(row.id)?.id).toBe(row.id);
    expect(heard.find(([e]) => e === 'engine.ran')![1].reason).toBe('late_points');
    expect(events().slice(-2)).toEqual(['shift.updated', 'stops.derived']);
    book.finalize(row);
    heard = [];
    expect(book.latePoints(row.id)).toBeUndefined();
    expect(heard).toEqual([]);
  });

  test('purge tells the phone which keys went', () => {
    const row = rideShift();
    const keys = createProcessingRepository(h.db)
      .tripsOf(row.id)
      .map((t) => t.tripKey);
    heard = [];
    book.purge(web, row);
    expect(createShiftRepository(h.db).byId(row.id)).toBeUndefined();
    expect(heard).toEqual([
      [
        'shift.deleted',
        {
          shiftId: String(row.id),
          userId: '1',
          clientId: SHIFT,
          tripKeys: keys,
          overrideKeys: [],
          odometerIds: [],
        },
      ],
    ]);
  });
});

describe('imported shifts', () => {
  const plan = (day: number, totalM: number) => ({
    vehicleId: 1,
    startedAt: h.clock.t - day * DAY,
    endedAt: h.clock.t - day * DAY + 3_600_000,
    localDate: '2027-01-1' + (5 - day),
    totalM,
    notes: null,
  });

  test('are recorded with their trip, flag and totals, and announced', () => {
    const rows = book.importShifts(1, [plan(1, 12_000), plan(2, 8_000)]);
    expect(rows.map((r) => [r.status, r.totalM, r.activeM, r.personalM, r.segmenter])).toEqual([
      ['finalized', 12_000, 12_000, 0, 'whole_shift'],
      ['finalized', 8_000, 8_000, 0, 'whole_shift'],
    ]);
    // Worked out at import, so the phone's pull carries the trips.
    expect(rows.every((r) => r.calculatedAt === h.clock.t)).toBe(true);
    const repo = createProcessingRepository(h.db);
    expect(repo.tripsOf(rows[0]!.id)).toEqual([
      expect.objectContaining({
        tripKey: `import-${rows[0]!.id}`,
        kind: 'active',
        source: 'manual',
        distanceM: 12_000,
      }),
    ]);
    expect(
      repo
        .flagsOf([rows[0]!.id])
        .get(rows[0]!.id)!
        .map((f) => f.code),
    ).toEqual(['imported']);
    expect(heard).toEqual(rows.map((r) => ['shift.updated', { shiftId: String(r.id) }]));
  });

  test('all or nothing: a failure in one row writes none and announces nothing', () => {
    expect(() =>
      book.importShifts(1, [plan(1, 12_000), plan(2, 8_000)], (_s, i) => {
        if (i === 1) throw new Error('earnings refused');
      }),
    ).toThrow('earnings refused');
    expect(createShiftRepository(h.db).list(1, { limit: 10 })).toEqual([]);
    expect(heard).toEqual([]);
  });
});
