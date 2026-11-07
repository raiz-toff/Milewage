/**
 * The location source seen by the rest of the app (09 section 5.1 item 5, README 1.3 rule 4).
 * The Android module implements it; an iOS module or the fake can replace it without touching
 * callers. Points are identified by their device-assigned `seq`.
 */
export interface CadenceConfig {
  intervalMs?: number;
  minDisplacementM?: number;
  maxUpdateDelayMs?: number;
  stillTimeoutMs?: number;
}

/** A buffered fix in the wire units of 08 section 5 (e7 degrees, metres, dm/s). */
export interface TrackerPoint {
  seq: number;
  shiftClientId: string;
  recordedAt: number;
  latE7: number;
  lonE7: number;
  accuracyM: number;
  speedDmps: number | null;
  bearingDeg: number | null;
  altitudeM: number | null;
}

/**
 * The parts of the running-shift notification that do not change during a shift. The tracker
 * counts the distance itself, so the notification stays current while the app is in the background.
 */
export interface ShiftNotice {
  startedAt: number;
  unit: 'km' | 'mi';
  /** Metres of the shifts already ended today (the instance's local date). */
  earlierM: number;
  earlierShifts: number;
  /** Last line of the expanded notification, for example "Started 09:02 · Toyota Prius". */
  footer: string;
}

export interface Tracker {
  /** False when the service could not start (blank shift id, bad cadence, no permission). */
  start(shiftClientId: string, cadence?: CadenceConfig): boolean;
  stop(): void;
  isTracking(): boolean;
  /** Oldest PENDING points first, at most `limit`. */
  readPending(limit: number): TrackerPoint[];
  /**
   * Rows of one shift with `seq` above `afterSeq`, PENDING and UPLOADED alike (quarantined rows
   * are not in the buffer), oldest first, at most `limit`. Read only; lets the live distance be
   * rebuilt exactly after an app restart.
   */
  readByShift(shiftClientId: string, afterSeq: number, limit: number): TrackerPoint[];
  /** PENDING to UPLOADED. Rows stay until `evictUploaded`. Returns how many changed. */
  markUploaded(seqs: number[]): number;
  /** Permanently refused PENDING points go to quarantine. Returns how many moved. */
  markRejected(seqs: number[]): number;
  /** Deletes UPLOADED rows acknowledged before the cutoff; never a PENDING row. */
  evictUploaded(olderThanMs: number): number;
  /** Latest `fix_time - now` in ms, or null when no fix in the last 10 minutes. */
  gnssOffsetMs(): number | null;
  /** Opens the system battery settings; false if it cannot. */
  requestBatteryOptimizationSettings(): boolean;
  /** Sets what the running-shift notification says around the distance; cleared by `stop`. */
  setNotice(notice: ShiftNotice): void;
}
