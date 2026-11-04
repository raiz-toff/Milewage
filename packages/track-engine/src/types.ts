// Types of the shared track engine (14 section 3).
// All numbers are integers. Times are UTC epoch milliseconds. Coordinates are degrees x 1e7.

export interface Fix {
  seq: number; // device-assigned, strictly increasing, never reused
  recordedAt: number; // the fix's own GNSS time
  latE7: number;
  lonE7: number;
  accuracyM: number; // horizontal accuracy radius, whole metres
  speedDmps?: number; // reported speed, decimetres per second
  bearingDeg?: number;
  altitudeM?: number;
}

export interface StopLabelInput {
  stopKey: string;
  role: 'pickup' | 'dropoff' | 'other';
}

export interface Stop {
  stopKey: string; // `${shiftClientId}:${startedAt}:stop`
  startedAt: number;
  endedAt: number;
  dwellS: number;
  latE7: number;
  lonE7: number;
  confidence: 'low' | 'medium' | 'high';
  estRole: 'pickup' | 'dropoff' | 'none';
  role: 'pickup' | 'dropoff' | 'other' | 'none';
}

// 07 section 2.3 trip row, as far as the engine produces it.
export interface Trip {
  tripKey: string; // `<shiftClientId>:<segment start ms>:<original kind>`
  kind: 'active' | 'deadhead' | 'personal';
  originalKind: 'active' | 'deadhead';
  startedAt: number;
  endedAt: number;
  startLatE7: number;
  startLonE7: number;
  endLatE7: number;
  endLonE7: number;
  distanceM: number;
  purpose: string;
}

// A driver reclassification (07 section 3 rule 7), keyed by tripKey (14 section 6.7).
export interface TripEdit {
  tripKey: string;
  kind?: 'active' | 'deadhead' | 'personal';
  purpose?: string;
}

export type FlagCode =
  | 'gap_counted'
  | 'gap_large'
  | 'gap_dropped'
  | 'tracking_interrupted'
  | 'shift_auto_closed'
  | 'no_stops_detected'
  | 'long_stop'
  | 'label_orphaned'
  | 'poor_accuracy_share'
  | 'low_fix_density'
  | 'clock_skew'
  | 'override_orphaned'
  | 'manual_trip_present'
  | 'calc_mismatch';

export interface Flag {
  code: FlagCode;
  at?: number; // epoch ms the flag refers to, when it has one
  detail?: string;
}

export interface ShiftInput {
  shiftClientId: string;
  startedAt: number;
  endedAt: number;
  fixes: Fix[]; // any order, duplicates allowed
  segmenter: 'stops' | 'whole_shift';
  stopLabels?: StopLabelInput[];
  interruptions?: { fromMs: number; toMs: number }[];
  edits?: TripEdit[];
  /** True when the app ended an unfinished shift at its last fix (14 section 7.4). */
  autoClosed?: boolean;
  /** Median phone-clock minus GNSS time in ms, measured by the app on live fixes (14 section 15). */
  clockSkewMs?: number;
}

export interface ShiftResult {
  algorithmVersion: number;
  inputDigest: string;
  totals: { totalM: number; activeM: number; deadheadM: number; personalM: number };
  trips: Trip[];
  stops: Stop[];
  route: { latE7: number; lonE7: number; t: number }[];
  flags: Flag[];
  stats: Record<string, number>;
}
