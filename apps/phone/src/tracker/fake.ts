import type { CadenceConfig, Tracker, TrackerPoint } from './types';

interface Row extends TrackerPoint {
  status: 'PENDING' | 'UPLOADED';
  uploadedAt: number | null;
}

const GNSS_FRESH_MS = 10 * 60 * 1000;

/**
 * In-memory tracker with the same semantics as the Kotlin buffer: strictly increasing `seq`,
 * `markUploaded` keeps rows, eviction never touches PENDING rows. `emit` plays the role of the
 * foreground service writing a fix.
 */
export class FakeTracker implements Tracker {
  private rows: Row[] = [];
  private quarantine: number[] = [];
  private nextSeq = 1;
  private shiftId: string | null = null;
  private offset: { value: number; at: number } | null = null;
  batterySettingsOpened = 0;

  constructor(private readonly now: () => number = Date.now) {}

  start(shiftClientId: string, cadence?: CadenceConfig): boolean {
    if (shiftClientId.trim() === '') return false;
    if (cadence?.intervalMs !== undefined && !(cadence.intervalMs >= 1000)) return false;
    this.shiftId = shiftClientId;
    return true;
  }

  stop(): void {
    this.shiftId = null;
  }

  isTracking(): boolean {
    return this.shiftId !== null;
  }

  /** Test hook: a fix delivered by the (simulated) service. Ignored when not tracking. */
  emit(fix: Partial<TrackerPoint> & { recordedAt: number }): number | null {
    if (this.shiftId === null) return null;
    const seq = this.nextSeq++;
    this.rows.push({
      seq,
      shiftClientId: this.shiftId,
      latE7: 0,
      lonE7: 0,
      accuracyM: 5,
      speedDmps: null,
      bearingDeg: null,
      altitudeM: null,
      ...fix,
      status: 'PENDING',
      uploadedAt: null,
    });
    this.offset = { value: fix.recordedAt - this.now(), at: this.now() };
    return seq;
  }

  readPending(limit: number): TrackerPoint[] {
    return this.rows
      .filter((r) => r.status === 'PENDING')
      .slice(0, Math.max(0, limit))
      .map((r) => ({
        seq: r.seq,
        shiftClientId: r.shiftClientId,
        recordedAt: r.recordedAt,
        latE7: r.latE7,
        lonE7: r.lonE7,
        accuracyM: r.accuracyM,
        speedDmps: r.speedDmps,
        bearingDeg: r.bearingDeg,
        altitudeM: r.altitudeM,
      }));
  }

  markUploaded(seqs: number[]): number {
    const want = new Set(seqs);
    let n = 0;
    for (const r of this.rows) {
      if (r.status === 'PENDING' && want.has(r.seq)) {
        r.status = 'UPLOADED';
        r.uploadedAt = this.now();
        n++;
      }
    }
    return n;
  }

  markRejected(seqs: number[]): number {
    const want = new Set(seqs);
    const moved = this.rows.filter((r) => r.status === 'PENDING' && want.has(r.seq));
    this.rows = this.rows.filter((r) => !moved.includes(r));
    this.quarantine.push(...moved.map((r) => r.seq));
    return moved.length;
  }

  evictUploaded(olderThanMs: number): number {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) => !(r.status === 'UPLOADED' && r.uploadedAt !== null && r.uploadedAt < olderThanMs),
    );
    return before - this.rows.length;
  }

  gnssOffsetMs(): number | null {
    return this.offset && this.now() - this.offset.at <= GNSS_FRESH_MS ? this.offset.value : null;
  }

  requestBatteryOptimizationSettings(): boolean {
    this.batterySettingsOpened++;
    return true;
  }

  /** Test hook: seqs that were quarantined. */
  get quarantined(): readonly number[] {
    return this.quarantine;
  }
}
