import type { Fix } from '@milewage/track-engine';
import type { Tracker, TrackerPoint } from '../tracker/types';

export const toFix = (p: TrackerPoint): Fix => ({
  seq: p.seq,
  recordedAt: p.recordedAt,
  latE7: p.latE7,
  lonE7: p.lonE7,
  accuracyM: p.accuracyM,
  ...(p.speedDmps !== null && { speedDmps: p.speedDmps }),
  ...(p.bearingDeg !== null && { bearingDeg: p.bearingDeg }),
  ...(p.altitudeM !== null && { altitudeM: p.altitudeM }),
});

/** Reads at most this many pending points per pump; a shift's backlog is far below it. */
export const PUMP_LIMIT = 10_000;

/**
 * The one reader of the tracker buffer. The live distance and the upload worker both read through
 * it, so a point is shown to every listener before the worker can mark it uploaded and it drops
 * out of `readPending`. (The tracker interface has no "read after seq", 09 section 5.1.)
 */
export class PointFeed {
  private maxSeq = 0;
  private listeners = new Set<(p: TrackerPoint) => void>();

  constructor(private readonly tracker: Tracker) {}

  subscribe(fn: (p: TrackerPoint) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** `tracker.readPending(limit)`, announcing points not seen before. */
  readPending(limit: number): TrackerPoint[] {
    const points = this.tracker.readPending(limit);
    for (const p of points) {
      if (p.seq <= this.maxSeq) continue;
      this.maxSeq = p.seq;
      for (const fn of this.listeners) fn(p);
    }
    return points;
  }
}
