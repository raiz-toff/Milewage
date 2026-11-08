import type { LocalRun } from '../shift/endPayload';

/** The phone's battery at one moment: whole per cent, 0 to 100, and whether it is charging. */
export interface BatteryReading {
  level: number;
  charging: boolean;
}

/**
 * The battery as the shift summary needs it (16 section 3.2, `shift.summary`). Read at shift
 * start and at shift end only; nothing listens in between. Null when the phone cannot say; the
 * summary is then not sent, because the allowlist requires both levels.
 */
export interface BatteryPort {
  read(): Promise<BatteryReading | null>;
}

/** A `BatteryPort` over any reader; a reader that throws or answers nonsense reads as null. */
export function batteryPort(read: () => Promise<BatteryReading | null>): BatteryPort {
  return {
    read: async () => {
      try {
        const r = await read();
        return r && Number.isInteger(r.level) && r.level >= 0 && r.level <= 100
          ? { level: r.level, charging: r.charging === true }
          : null;
      } catch {
        return null;
      }
    },
  };
}

/** The `shift.summary` data of 16 section 3.2, in the shared allowlist's field names. */
export interface ShiftSummary {
  duration_s: number;
  battery_start: number;
  battery_end: number;
  charging_seen: boolean;
  fixes: number;
  gap_count: number;
  service_restarts: number;
  engine_ms: number;
  capture: boolean;
}

/**
 * What is known at shift end. No coordinates and no ids: counts and levels only.
 * `charging_seen` is true when the phone was charging at start or at end; a charge in between is
 * not seen. The foreground service does not report its restarts yet (09 section 5.4 is Kotlin
 * work), so `service_restarts` is 0 until it does; the phone has no capture mode, so `capture`
 * is false.
 */
export function buildShiftSummary(a: {
  startedAt: number;
  endedAt: number;
  start: BatteryReading;
  end: BatteryReading;
  local: LocalRun | null;
  engineMs: number;
}): ShiftSummary {
  return {
    duration_s: Math.max(0, Math.round((a.endedAt - a.startedAt) / 1000)),
    battery_start: a.start.level,
    battery_end: a.end.level,
    charging_seen: a.start.charging || a.end.charging,
    fixes: a.local?.manifest.pointCount ?? 0,
    // One gap is one `gap_counted` or one `gap_dropped`; `gap_large` only qualifies a counted one.
    gap_count:
      a.local?.result.flags.filter((f) => f.code === 'gap_counted' || f.code === 'gap_dropped')
        .length ?? 0,
    service_restarts: 0,
    engine_ms: Math.min(86_400_000, Math.max(0, Math.round(a.engineMs))),
    capture: false,
  };
}
