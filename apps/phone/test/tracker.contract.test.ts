import { FakeTracker } from '../src/tracker/fake';
import type { Tracker } from '../src/tracker/types';

/** Contract every Tracker must meet; the fake runs it here, a device build can run it on the module. */
export function trackerContract(
  name: string,
  make: () => Tracker,
  emit: (t: Tracker, at: number) => number,
) {
  describe(`Tracker contract: ${name}`, () => {
    it('refuses a blank shift id and reports tracking state', () => {
      const t = make();
      expect(t.start('  ')).toBe(false);
      expect(t.isTracking()).toBe(false);
      expect(t.start('shift-1', { intervalMs: 5000 })).toBe(true);
      expect(t.isTracking()).toBe(true);
      t.stop();
      expect(t.isTracking()).toBe(false);
    });

    it('returns pending points oldest first with a limit', () => {
      const t = make();
      t.start('s');
      const seqs = [1, 2, 3].map((i) => emit(t, i));
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(t.readPending(2).map((p) => p.seq)).toEqual(seqs.slice(0, 2));
      expect(t.readPending(0)).toEqual([]);
    });

    it('markUploaded removes points from pending but only once', () => {
      const t = make();
      t.start('s');
      const [a, b] = [emit(t, 1), emit(t, 2)] as [number, number];
      expect(t.markUploaded([a])).toBe(1);
      expect(t.markUploaded([a])).toBe(0);
      expect(t.readPending(10).map((p) => p.seq)).toEqual([b]);
    });

    it('evictUploaded never deletes a pending point', () => {
      const t = make();
      t.start('s');
      const [a, b] = [emit(t, 1), emit(t, 2)] as [number, number];
      t.markUploaded([a]);
      expect(t.evictUploaded(Number.MAX_SAFE_INTEGER)).toBe(1);
      expect(t.evictUploaded(Number.MAX_SAFE_INTEGER)).toBe(0);
      expect(t.readPending(10).map((p) => p.seq)).toEqual([b]);
    });

    it('readByShift returns pending and uploaded rows of one shift after a seq', () => {
      const t = make();
      t.start('one');
      const [a, b] = [emit(t, 1), emit(t, 2)] as [number, number];
      t.stop();
      t.start('two');
      emit(t, 3);
      t.start('one');
      const c = emit(t, 4);
      t.markUploaded([a, b]);
      expect(t.readByShift('one', 0, 10).map((p) => p.seq)).toEqual([a, b, c]);
      expect(t.readByShift('one', a, 10).map((p) => p.seq)).toEqual([b, c]);
      expect(t.readByShift('one', 0, 2).map((p) => p.seq)).toEqual([a, b]);
      expect(t.readByShift('nope', 0, 10)).toEqual([]);
      expect(t.readByShift('one', 0, 0)).toEqual([]);
      // reading changes nothing
      expect(t.readPending(10).map((p) => p.seq)).toContain(c);
    });

    it('markRejected removes pending points and never reuses their seq', () => {
      const t = make();
      t.start('s');
      const a = emit(t, 1);
      expect(t.markRejected([a])).toBe(1);
      expect(t.readPending(10)).toEqual([]);
      expect(emit(t, 2)).toBeGreaterThan(a);
    });
  });
}

let clock = 1_000_000;
trackerContract(
  'FakeTracker',
  () => new FakeTracker(() => clock),
  (t, at) => (t as FakeTracker).emit({ recordedAt: at }) as number,
);

describe('FakeTracker specifics', () => {
  it('keeps uploaded rows until the cutoff passes their acknowledgement time', () => {
    clock = 5_000;
    const t = new FakeTracker(() => clock);
    t.start('s');
    const a = t.emit({ recordedAt: 1 }) as number;
    t.markUploaded([a]);
    expect(t.evictUploaded(5_000)).toBe(0); // uploaded_at < cutoff is strict
    expect(t.evictUploaded(5_001)).toBe(1);
  });

  it('gnssOffsetMs is fix time minus now and goes stale after 10 minutes', () => {
    clock = 100_000;
    const t = new FakeTracker(() => clock);
    expect(t.gnssOffsetMs()).toBeNull();
    t.start('s');
    t.emit({ recordedAt: 98_500 });
    expect(t.gnssOffsetMs()).toBe(-1_500);
    clock += 10 * 60 * 1000 + 1;
    expect(t.gnssOffsetMs()).toBeNull();
  });

  it('records quarantined seqs and ignores fixes while stopped', () => {
    const t = new FakeTracker(() => clock);
    expect(t.emit({ recordedAt: 1 })).toBeNull();
    t.start('s');
    const a = t.emit({ recordedAt: 1 }) as number;
    t.markRejected([a]);
    expect(t.quarantined).toEqual([a]);
  });
});
