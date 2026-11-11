import { describe, expect, it } from 'vitest';
import type { Schemas } from '../src/api/client';
import { earnedOf, kindOf, reviewCount, shiftView } from '../src/shift/view';
import type { ShiftParts } from '../src/shift/view';
import { settingsFixture } from './support/kit';
import { shift as shiftFixture, stop, trip } from './support/fixtures';

type Shift = Schemas['Shift'];
type Trip = Schemas['Trip'];

const read = <T>(data: T | null, error: string | null = null) => ({ data, error });

/** An ended shift with two trips, one stop and a route, as the record has it once all is read. */
function parts(
  over: Omit<Partial<ShiftParts>, 'shift'> & { shift?: Partial<Shift> } = {},
): ShiftParts {
  const { shift: s, ...rest } = over;
  return {
    shift: shiftFixture(s) as Shift,
    trips: read([trip(1), trip(2)] as Trip[]),
    stops: read([stop(1)]),
    route: { points: [{}, {}] },
    earned: { cents: 2500, platforms: [{ slug: 'uber_eats', label: 'Uber Eats' }] },
    vehicle: 'Corolla',
    ...rest,
  };
}

const on = settingsFixture();

describe('shiftView: the shift page from its record', () => {
  it('a shift with trips and stops: the full layout with the estimated split', () => {
    const v = shiftView(parts(), on);
    expect(v).toMatchObject({
      active: false,
      split: true,
      main: 'map',
      sideBySide: true,
      sparse: false,
      folded: false,
      checks: true,
      stopsCard: true,
      canAddTrip: true,
      canEditTrips: true,
      noTrips: false,
      exporters: true,
      costs: true,
      showEarnings: true,
      timelineNote: '2 trips · 1 stop',
      review: 0,
    });
    expect(v.earned).toEqual({
      cents: 2500,
      platforms: [{ slug: 'uber_eats', label: 'Uber Eats' }],
    });
    expect(v.platforms.map((p) => p.slug)).toEqual(['uber_eats']);
    // 1_700_000_000_000 is 17:13 in Toronto; the shift is an hour long.
    expect(v.context).toBe('17:13 – 18:13 · 1h 00m · Corolla');
  });

  it('no stops: the quieter tools fold into one card and there is nothing to label', () => {
    const v = shiftView(parts({ stops: read([]) }), on);
    expect(v).toMatchObject({ folded: true, stopsCard: false, checks: true, sparse: false });
    expect(v.timelineNote).toBe('2 trips · 0 stops');
  });

  it('stops off: no split, no stops in the note, no labelling, and the stops are not waited for', () => {
    const off = settingsFixture({ modules: { stops: false } });
    const v = shiftView(parts({ stops: read(null) }), off);
    expect(v).toMatchObject({ split: false, stopsCard: false, folded: false });
    expect(v.timelineNote).toBe('2 trips');
  });

  it('while the stops load, labelling is offered and the layout does not fold', () => {
    const v = shiftView(parts({ stops: read(null) }), on);
    expect(v).toMatchObject({ folded: false, stopsCard: true, timelineNote: '2 trips' });
  });

  it('a shift with no distance has no split, even when segmented by stops', () => {
    expect(shiftView(parts({ shift: { total_m: 0 } }), on).split).toBe(false);
    expect(shiftView(parts({ shift: { segmenter: 'whole_shift' } }), on).split).toBe(false);
  });

  it('personal trips read as personal; without the split, active and deadhead read as business', () => {
    const personal = trip(1, { kind: 'personal' }) as Trip;
    const auto = trip(2, { kind: 'deadhead', source: 'auto' }) as Trip;
    const manual = trip(3, { kind: 'active', source: 'manual' }) as Trip;
    expect(kindOf(personal, true)).toEqual({ text: 'personal', estimated: false });
    expect(kindOf(personal, false)).toEqual({ text: 'personal', estimated: false });
    expect(kindOf(auto, true)).toEqual({ text: 'deadhead', estimated: true });
    expect(kindOf(manual, true)).toEqual({ text: 'active', estimated: false });
    expect(kindOf(auto, false)).toEqual({ text: 'business', estimated: false });
  });

  it('a reviewed (finalized) shift takes no new trip but keeps its figures and export', () => {
    const v = shiftView(parts({ shift: { status: 'finalized' } }), on);
    expect(v).toMatchObject({
      canAddTrip: false,
      canEditTrips: false,
      exporters: true,
      showEarnings: true,
      main: 'map',
    });
  });

  it('flags present: the review count, and a label that lost its stop keeps labelling open', () => {
    const flags = [
      { code: 'gap_large', severity: 'review' as const },
      { code: 'label_orphaned', severity: 'review' as const },
      { code: 'no_stops_detected', severity: 'info' as const },
    ];
    const s = parts({ shift: { flags }, stops: read([]) });
    expect(reviewCount(s.shift)).toBe(2);
    const v = shiftView(s, on);
    expect(v).toMatchObject({ review: 2, folded: false, stopsCard: true });
  });

  it('a running shift: the in-progress card, start and end only, no earnings or export yet', () => {
    const v = shiftView(
      parts({ shift: { status: 'active', ended_at: null }, earned: null, route: { points: null } }),
      on,
    );
    expect(v).toMatchObject({
      active: true,
      main: 'in-progress',
      sparse: true,
      folded: true,
      checks: false,
      timelineNote: 'Start and end only',
      showEarnings: false,
      earned: undefined,
      platforms: [],
      exporters: false,
      // Parking and tolls are paid during a shift too.
      costs: true,
      canAddTrip: false,
      canEditTrips: false,
    });
    expect(v.context).toBe('17:13 – now · in progress · Corolla');
  });

  it('nothing recorded: the card that explains why, with the checks inside it', () => {
    const v = shiftView(
      parts({ trips: read([]), stops: read([]), route: { points: [] }, vehicle: null }),
      on,
    );
    expect(v).toMatchObject({
      main: 'nothing-recorded',
      sparse: true,
      folded: true,
      checks: false,
      canAddTrip: false,
      // A trip typed in later can still be changed while the shift is not finalized.
      canEditTrips: true,
      noTrips: false,
      stopsCard: false,
    });
    expect(v.context).toBe('17:13 – 18:13 · 1h 00m');
  });

  it('with the map off, an empty shift is decided by trips and stops alone, and the list stands in', () => {
    const noMap = settingsFixture({ modules: { replay: false } });
    expect(shiftView(parts({ route: { points: null } }), noMap)).toMatchObject({
      main: 'list',
      sideBySide: false,
    });
    expect(
      shiftView(parts({ trips: read([]), stops: read([]), route: { points: null } }), noMap).main,
    ).toBe('nothing-recorded');
  });

  it('earnings: undefined when the module is off, null while they load', () => {
    const off = settingsFixture({ modules: { earnings: false } });
    expect(shiftView(parts(), off)).toMatchObject({ showEarnings: false, earned: undefined });
    expect(shiftView(parts({ earned: null }), on)).toMatchObject({ earned: null, platforms: [] });
  });

  it('earnedOf: the effective total, or null when nothing was entered or labelled', () => {
    const row = (total_cents: number) => ({ total_cents }) as never;
    expect(earnedOf({ effective: [row(1200), row(800)] } as never)).toBe(2000);
    expect(earnedOf({ effective: [] } as never)).toBeNull();
  });
});

describe('shiftView: parking and tolls and the export row', () => {
  it('follow the expenses module, and the PDF report alone gives no shift export', () => {
    const off = settingsFixture({ modules: { expenses: false, exporters: ['pdf'] } });
    expect(shiftView(parts(), off)).toMatchObject({ costs: false, exporters: false });
  });
});
