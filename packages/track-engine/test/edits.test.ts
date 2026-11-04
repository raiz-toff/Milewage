import { describe, expect, test } from 'vitest';
import {
  applyEdits,
  buildTrips,
  makeTripKey,
  processShift,
  totalsOf,
  type TripDraft,
  type TripEdit,
} from '../src/index';
import { goldenInputs } from './support/goldenShift';
import { fixAt } from './support/scenarios';

const base = goldenInputs().ride_grid!;
const first = processShift(base);
const key = first.trips[0]!.tripKey;

const draft = (startedAt: number, kind: 'active' | 'deadhead', dm: number): TripDraft => ({
  originalKind: kind,
  startedAt,
  endedAt: startedAt + 1000,
  startLatE7: 0,
  startLonE7: 0,
  endLatE7: 0,
  endLonE7: 0,
  distanceDm: dm,
  purpose: kind === 'active' ? 'Delivery' : 'Repositioning',
});

describe('trip_key', () => {
  test('is <client id>:<start ms>:<original kind>, the same on every run', () => {
    expect(makeTripKey('abc', 1700000000000, 'deadhead')).toBe('abc:1700000000000:deadhead');
    expect(key).toBe(`${base.shiftClientId}:${first.trips[0]!.startedAt}:active`);
    expect(processShift(base).trips[0]!.tripKey).toBe(key);
  });

  test('does not change when the order or duplicates of the input change', () => {
    const r = processShift({ ...base, fixes: [...base.fixes].reverse().concat(base.fixes) });
    expect(r.trips[0]!.tripKey).toBe(key);
  });
});

describe('stage 7 edits', () => {
  test('reclassifying to personal moves the metres, never changes the distance', () => {
    const r = processShift({ ...base, edits: [{ tripKey: key, kind: 'personal' }] });
    expect(r.trips[0]).toMatchObject({ kind: 'personal', originalKind: 'active' });
    expect(r.trips[0]!.distanceM).toBe(first.trips[0]!.distanceM);
    expect(r.totals).toEqual({
      totalM: first.totals.totalM,
      activeM: 0,
      deadheadM: 0,
      personalM: first.totals.totalM,
    });
    expect(r.flags).toEqual(first.flags);
  });

  test('a purpose-only edit keeps the kind; an empty edit changes nothing', () => {
    const r = processShift({ ...base, edits: [{ tripKey: key, purpose: 'Groceries' }] });
    expect(r.trips[0]).toMatchObject({ kind: 'active', purpose: 'Groceries' });
    const none = processShift({ ...base, edits: [{ tripKey: key }] });
    expect(none.trips).toEqual(first.trips);
  });

  test('the edit survives a recompute with more fixes after the trip start', () => {
    const late = [fixAt(900, 2000, 20000, 0)];
    const edits: TripEdit[] = [{ tripKey: key, kind: 'personal' }];
    const r = processShift({
      ...base,
      endedAt: base.endedAt + 2_000_000,
      fixes: [...base.fixes, ...late],
      edits,
    });
    expect(r.trips[0]!.tripKey).toBe(key);
    expect(r.trips[0]!.kind).toBe('personal');
    expect(r.flags.some((f) => f.code === 'override_orphaned')).toBe(false);
  });

  test('an orphaned edit is flagged, not applied, and not re-attached to another trip', () => {
    const wrongKind = makeTripKey(base.shiftClientId, first.trips[0]!.startedAt, 'deadhead');
    const wrongStart = makeTripKey(base.shiftClientId, first.trips[0]!.startedAt + 1, 'active');
    const r = processShift({
      ...base,
      edits: [
        { tripKey: wrongKind, kind: 'personal' },
        { tripKey: wrongStart, kind: 'personal' },
        { tripKey: wrongStart, purpose: 'again' },
      ],
    });
    expect(r.trips).toEqual(first.trips);
    expect(r.totals).toEqual(first.totals);
    expect(r.flags.filter((f) => f.code === 'override_orphaned')).toEqual([
      { code: 'override_orphaned', detail: wrongKind },
      { code: 'override_orphaned', detail: wrongStart },
    ]);
  });

  test('a start that moved (an earlier late fix) orphans the edit instead of guessing', () => {
    const early = fixAt(901, -60, -500, 0); // 1 minute before the first fix, 500 m south
    const r = processShift({
      ...base,
      fixes: [...base.fixes, early],
      edits: [{ tripKey: key, kind: 'personal' }],
    });
    expect(r.trips[0]!.tripKey).not.toBe(key);
    expect(r.trips[0]!.kind).toBe('active');
    expect(r.flags.find((f) => f.code === 'override_orphaned')?.detail).toBe(key);
  });

  test('the order of the edits does not matter', () => {
    const a: TripEdit[] = [
      { tripKey: key, kind: 'personal' },
      { tripKey: key, kind: 'deadhead' },
    ];
    const r1 = processShift({ ...base, edits: a });
    const r2 = processShift({ ...base, edits: [...a].reverse() });
    expect(r2).toEqual(r1);
  });

  test('with several trips only the named one changes, and totals stay consistent', () => {
    const trips = buildTrips('s', [
      draft(1000, 'deadhead', 1004),
      draft(2000, 'active', 2006),
      draft(3000, 'deadhead', 3000),
    ]);
    expect(trips.map((t) => t.distanceM)).toEqual([100, 201, 300]); // cumulative rounding: 100, 301, 601 -> sum 601
    const { trips: out, flags } = applyEdits(trips, [
      { tripKey: 's:2000:active', kind: 'personal' },
    ]);
    expect(flags).toEqual([]);
    expect(out.map((t) => t.kind)).toEqual(['deadhead', 'personal', 'deadhead']);
    expect(totalsOf(out)).toEqual({ totalM: 601, activeM: 0, deadheadM: 400, personalM: 201 });
    expect(trips[1]!.kind).toBe('active'); // input not mutated
  });
});
