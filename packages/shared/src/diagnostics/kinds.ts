import { PATTERNS, bool, int, ints, obj, objs, oneOf, str, strs, type Shape } from './schema';

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

/** The modules whose switches a diagnostics event carries (`server.start`, `settings.applied`, the debug bundle). */
export const DIAGNOSED_MODULES = [
  'devices',
  'tracking',
  'stops',
  'replay',
  'sync',
  'exporters',
  'diagnostics',
] as const;
// Module flags as bools; a module that does not exist in a build is simply absent.
const MODULE_FLAGS: Shape = Object.fromEntries(DIAGNOSED_MODULES.map((m) => [m, bool(true)]));
const DISK_STATES = ['ok', 'warning', 'backup_skipped', 'writes_blocked'];
const SIGNED = int(-1_000_000_000, 1_000_000_000);

export const diagKinds = {
  'service.event': {
    level: 'basic',
    src: ['phone_native'],
    data: {
      event: oneOf(SERVICE_EVENTS),
      reason: oneOf(SERVICE_REASONS),
      profile: oneOf(['normal']),
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
      // Sent (always false) by phone apps from before capture sessions were removed; ignored.
      capture: bool(true),
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
  'activity.transition': {
    level: 'verbose',
    src: ['phone_native'],
    data: {
      type: oneOf(['STILL', 'IN_VEHICLE', 'ON_BICYCLE', 'WALKING', 'RUNNING', 'UNKNOWN']),
      edge: oneOf(['enter', 'exit']),
      gating_acted: bool(),
    },
  },
  'perm.state': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      fine: bool(),
      background: oneOf(['all_time', 'while_in_use', 'denied']),
      activity_recognition: bool(),
      notifications: bool(),
      battery_opt_ignored: bool(),
      standby_bucket: oneOf([
        'active',
        'working_set',
        'frequent',
        'rare',
        'restricted',
        'never',
        'unknown',
      ]),
      power_save: bool(),
    },
  },
  'upload.drain': {
    level: 'basic',
    src: ['phone_js'],
    data: { shifts: COUNT, points: COUNT, batches: COUNT, bytes_gz: BIG, wall_ms: BIG, ok: bool() },
  },
  'upload.failure': {
    level: 'verbose',
    src: ['phone_js'],
    data: {
      class: oneOf([
        'net',
        'timeout',
        'tls',
        'http_4xx',
        'http_5xx',
        'http_429',
        'http_507',
        'unknown',
      ]),
      status: int(0, 599),
      bytes: BIG,
      dur_ms: BIG,
      attempt: COUNT,
    },
  },
  'sync.state': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      state: oneOf([
        'reachable',
        'unreachable',
        'unauthorized',
        'revoked',
        'wrong_instance',
        'restored',
        'api_too_old',
      ]),
      since_s: COUNT,
    },
  },
  'sync.pull': {
    level: 'basic',
    src: ['phone_js'],
    data: { applied: COUNT, conflicts_logged: COUNT, full_window: bool() },
  },
  'settings.applied': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      level: oneOf(['off', 'basic', 'verbose']),
      stops_enabled: bool(),
      modules: obj(MODULE_FLAGS),
      engine_version: VERSION,
    },
  },
  'storage.state': {
    level: 'basic',
    src: ['phone_js'],
    data: {
      free_mb_bucket: oneOf(['lt20', 'lt50', 'lt200', 'lt1000', 'ge1000']),
      state: oneOf(['normal', 'low', 'critical']),
      tracker_db_mb: COUNT,
      app_db_mb: COUNT,
      unsynced_shifts: COUNT,
      pending_points: COUNT,
      quarantine_rows: COUNT,
    },
  },
  'stops.stats': {
    level: 'basic',
    src: ['phone_js', 'server'],
    data: {
      detected: COUNT,
      by_conf: ints(3, 0, 1_000_000),
      dwell_hist: ints(5, 0, 1_000_000),
      merged: COUNT,
      wake_used: COUNT,
      fallback: bool(),
    },
  },
  'stop.detected': {
    level: 'verbose',
    src: ['phone_js', 'server'],
    data: {
      stop_key: str(PATTERNS.stopKey),
      dwell_s: COUNT,
      conf: oneOf(['low', 'medium', 'high']),
      role_est: oneOf(['pickup', 'dropoff', 'none']),
      radius_max_dm: COUNT,
    },
  },
  'server.start': {
    level: 'basic',
    src: ['server'],
    data: {
      app_v: VERSION,
      schema_v: VERSION,
      sqlite_v: VERSION,
      node_v: VERSION,
      arch: VERSION,
      mem_limit_mb: COUNT,
      modules: obj(MODULE_FLAGS),
      unclean_shutdown: bool(),
    },
  },
  'server.sample': {
    level: 'basic',
    src: ['server'],
    data: {
      rss_mb: COUNT,
      heap_mb: COUNT,
      lag_p95_ms: MS,
      lag_max_ms: MS,
      cpu_pct: int(0, 100_000),
      db_bytes: BIG,
      wal_bytes: BIG,
      diag_db_bytes: BIG,
      disk_free_mb: BIG,
      disk_state: oneOf(DISK_STATES),
    },
  },
  'api.window': {
    level: 'basic',
    src: ['server'],
    data: {
      group: oneOf(['telemetry', 'shifts', 'sync', 'stops', 'exports', 'diagnostics', 'other']),
      n: COUNT,
      s2xx: COUNT,
      s4xx: COUNT,
      s5xx: COUNT,
      p50_ms: MS,
      p95_ms: MS,
      p99_ms: MS,
      codes: objs({ code: str(PATTERNS.code), n: COUNT }, 8),
      ingest: obj(
        {
          points_in: COUNT,
          inserted: COUNT,
          duplicates: COUNT,
          rejected: obj({
            invalid_coordinate: COUNT,
            future_timestamp: COUNT,
            outside_shift_window: COUNT,
          }),
        },
        true,
      ),
    },
  },
  'recon.result': {
    level: 'basic',
    src: ['server'],
    data: {
      status: oneOf(['match', 'differs', 'phone_missing']),
      reasons: strs(PATTERNS.code, 6),
      diff_m: SIGNED,
      digest_equal: bool(),
      phone_calc_v: int(0, 10_000),
      server_calc_v: int(0, 10_000),
    },
  },
  'backup.run': {
    level: 'basic',
    src: ['server'],
    data: {
      trigger: oneOf(['nightly', 'shift_end', 'manual', 'pre_migration', 'pre_restore']),
      ok: bool(),
      ms: BIG,
      bytes: BIG,
      lag_max_ms: MS,
    },
  },
  'migration.run': {
    level: 'basic',
    src: ['server'],
    data: { from_v: COUNT, to_v: COUNT, ms: BIG, pre_backup_ok: bool(), ok: bool() },
  },
  'restore.run': {
    level: 'basic',
    src: ['server'],
    data: {
      from_v: COUNT,
      to_v: COUNT,
      ms: BIG,
      pre_backup_ok: bool(),
      ok: bool(),
      counts_match: bool(),
    },
  },
  'disk.state': {
    level: 'basic',
    src: ['server'],
    data: { from: oneOf(DISK_STATES), to: oneOf(DISK_STATES) },
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
