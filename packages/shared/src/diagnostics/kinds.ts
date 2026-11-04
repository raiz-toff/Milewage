import { PATTERNS, bool, int, ints, obj, oneOf, str, strs, type Shape } from './schema';

// Catalogue of 16 section 3.2, A-rig set (section 9.3) plus `diag.self`. No free-text fields:
// `msg` is gated by class (validate.ts).

export type DiagSrc = 'phone_native' | 'phone_js' | 'server' | 'web';
export type DiagLevel = 'basic' | 'verbose';

export interface KindSpec {
  /** `basic` kinds are recorded at both levels, `verbose` kinds only at verbose. */
  level: DiagLevel;
  /** Producers allowed to emit this kind. */
  src: readonly DiagSrc[];
  data: Shape;
}

export const COUNT = int(0, 1_000_000_000);
export const BIG = int(0, 1_000_000_000_000);
export const MS = int(0, 86_400_000);
export const VERSION = str(PATTERNS.version);

// prettier-ignore
const SERVICE_EVENTS = ['created', 'started', 'restarted', 'destroyed', 'task_removed', 'fgs_start_refused', 'permission_lost', 'recovered', 'still_gate_on', 'still_gate_off'];
// prettier-ignore
const SERVICE_REASONS = ['user_stop', 'shift_end', 'task_removed', 'os_kill_inferred', 'start_not_allowed', 'permission', 'crash', 'unknown'];

// prettier-ignore
const EXIT_REASONS = ['crash', 'crash_native', 'anr', 'low_memory', 'signaled', 'user_requested', 'user_stopped', 'dependency_died', 'permission_change', 'excessive_resource_usage', 'freezer', 'initialization_failure', 'exit_self', 'other', 'unknown'];
// Engine counters of 14 section 8.
const ENGINE_STATS = [
  'non_positive_dt',
  'speed_spike',
  'within_gate',
  'low_accuracy',
  'fixes_in',
  'fixes_used',
  'gap_m',
];

export const diagKinds = {
  'service.event': {
    level: 'basic',
    src: ['phone_native'],
    data: {
      event: oneOf(SERVICE_EVENTS),
      reason: oneOf(SERVICE_REASONS),
      profile: oneOf(['normal', 'capture']),
    },
  },
  'track.window': {
    level: 'basic',
    src: ['phone_native'],
    data: {
      fixes: COUNT,
      acc_hist: ints(4, 0, 1_000_000),
      interval_p50_ms: MS,
      interval_max_ms: MS,
      still_gated_s: int(0, 600),
      battery_pct: int(0, 100),
      charging: bool(),
      temp_dc: int(-400, 1500),
      thermal: int(0, 6),
    },
  },
  'app.start': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      app_v: VERSION,
      native_v: VERSION,
      engine_v: VERSION,
      api_v: VERSION,
      device: obj({
        make: str(PATTERNS.deviceName),
        model: str(PATTERNS.deviceName),
        android: VERSION,
        sdk: int(1, 100),
        oneui: str(PATTERNS.version, true),
      }),
      prev_exit: obj({ reason: oneOf(EXIT_REASONS), importance: int(0, 1000), age_s: COUNT }, true),
    },
  },
  'upload.window': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      attempts: COUNT,
      ok: COUNT,
      fail_net: COUNT,
      fail_4xx: COUNT,
      fail_5xx: COUNT,
      fail_429: COUNT,
      fail_507: COUNT,
      bytes_gz: BIG,
      dur_p95_ms: MS,
      pending_points: COUNT,
      oldest_pending_s: COUNT,
    },
  },
  'shift.summary': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      duration_s: COUNT,
      battery_start: int(0, 100),
      battery_end: int(0, 100),
      charging_seen: bool(),
      fixes: COUNT,
      gap_count: COUNT,
      service_restarts: COUNT,
      engine_ms: MS,
      capture: bool(),
    },
  },
  'engine.run': {
    level: 'basic',
    src: ['phone_js', 'server'],
    data: {
      host: oneOf(['phone', 'server']),
      reason: oneOf(['shift_end', 'late_points', 'label', 'recalc', 'upgrade']),
      calc_version: int(0, 10_000),
      segmenter: oneOf(['stops', 'whole_shift']),
      input_digest: VERSION,
      ms: MS,
      stats: obj(Object.fromEntries(ENGINE_STATS.map((k) => [k, int(0, 1_000_000_000, true)]))),
      flags: strs(PATTERNS.code, 32),
      trips: COUNT,
      stops: COUNT,
      total_m: COUNT,
      active_m: COUNT,
      deadhead_m: COUNT,
    },
  },
  crash: {
    level: 'basic',
    src: ['phone_native', 'phone_js', 'server', 'web'],
    data: {
      runtime: oneOf(['js', 'native', 'server', 'web']),
      class: str(PATTERNS.identifier),
      frames: strs(PATTERNS.identifier, 15),
      fatal: bool(),
      sig: str(PATTERNS.version, true),
      // Only accepted when `class` is on the allowlist of 16 section 4.3 (checked in validate.ts).
      msg: str(PATTERNS.printable, true),
    },
  },
  'diag.self': {
    level: 'basic',
    src: ['phone_native', 'phone_js', 'server'],
    data: {
      dropped: obj({
        ring_full: COUNT,
        schema_reject: COUNT,
        level_off: COUNT,
        disk_low: COUNT,
      }),
      pending: COUNT,
      ring_kb: COUNT,
      cpu_ms_per_h: COUNT,
      writes_per_h: COUNT,
    },
  },
} as const satisfies Record<string, KindSpec>;

export type DiagKind = keyof typeof diagKinds;
export const diagKindNames = Object.keys(diagKinds) as DiagKind[];
