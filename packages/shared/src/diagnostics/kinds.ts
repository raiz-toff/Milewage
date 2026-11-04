import { PATTERNS, bool, int, ints, obj, oneOf, str, strs, type Shape } from './schema';

// Catalogue of 16 section 3.2; `app.start`, `upload.window`, `shift.summary`, `engine.run` follow in
// M2.10b (split for the 400-line cap). No free-text fields: `msg` is gated by class (validate.ts).

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
export const MS = int(0, 86_400_000);
export const VERSION = str(PATTERNS.version);

// prettier-ignore
const SERVICE_EVENTS = ['created', 'started', 'restarted', 'destroyed', 'task_removed', 'fgs_start_refused', 'permission_lost', 'recovered', 'still_gate_on', 'still_gate_off'];
// prettier-ignore
const SERVICE_REASONS = ['user_stop', 'shift_end', 'task_removed', 'os_kill_inferred', 'start_not_allowed', 'permission', 'crash', 'unknown'];

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
