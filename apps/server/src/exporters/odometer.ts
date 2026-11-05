import { localDate } from '../time';
import type { Db, ShiftRow } from '../db';

/** A shift whose odometer and GPS distances differ by more than this share (and 1 km) is flagged. */
export const SHIFT_TOLERANCE = 0.1;
const MIN_DIFF_M = 1000;
/** Tracked distance may exceed the year's odometer distance by this share before it is flagged (rounding, bike lifts). */
export const YEAR_TOLERANCE = 0.01;

export interface ShiftOdometer {
  startM: number | null;
  endM: number | null;
  /** '' when a reading or the GPS total is missing; otherwise ok, or a short statement of the mismatch. */
  check: string;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/**
 * Shift readings against the GPS total (08 section 11, 04 section 4). A mismatch is reported in the file and never
 * corrected: neither number is changed (the odometer is the driver's evidence, the GPS total is the engine's).
 */
export function shiftCheck(
  startM: number | null,
  endM: number | null,
  gpsM: number | null,
): string {
  if (startM === null || endM === null || gpsM === null) return '';
  if (endM < startM) return 'invalid: end reading is below start reading';
  const odo = endM - startM;
  const diff = Math.abs(odo - gpsM);
  if (diff > Math.max(SHIFT_TOLERANCE * Math.max(odo, gpsM), MIN_DIFF_M)) {
    return `mismatch: odometer ${km(odo)}; GPS ${km(gpsM)}`;
  }
  return 'ok';
}

/** The year's odometer distance against the distance tracked in that year (CRA: odometer at the start and end of the period). */
export function yearCheck(startM: number | null, endM: number | null, trackedM: number): string {
  if (startM === null || endM === null) return '';
  if (endM < startM) return 'invalid: year end reading is below year start reading';
  const odo = endM - startM;
  if (trackedM > odo * (1 + YEAR_TOLERANCE)) {
    return `mismatch: tracked ${km(trackedM)} exceeds odometer ${km(odo)}`;
  }
  return 'ok';
}

/** Reads the readings of a shift and of its vehicle's calendar year from the database (read only). */
export function createOdometerChecks(db: Db, userId: number, timeZone: string) {
  const reading = db.prepare(
    'SELECT reading_m FROM odometer_readings WHERE shift_id = ? AND kind = ? ORDER BY recorded_at DESC, id DESC LIMIT 1',
  );
  const yearReading = db.prepare(
    `SELECT reading_m, recorded_at FROM odometer_readings
      WHERE user_id = ? AND vehicle_id = ? AND kind = ? ORDER BY recorded_at DESC, id DESC`,
  );
  const tracked = db.prepare(
    `SELECT coalesce(sum(total_m), 0) FROM shifts
      WHERE user_id = ? AND vehicle_id = ? AND status IN ('ended','finalized') AND substr(local_date, 1, 4) = ?`,
  );
  const num = (r: unknown) => (r as { reading_m: number } | undefined)?.reading_m ?? null;
  const years = new Map<string, string>();
  return {
    shift(s: ShiftRow): ShiftOdometer {
      const startM = num(reading.get(s.id, 'shift_start'));
      const endM = num(reading.get(s.id, 'shift_end'));
      return { startM, endM, check: shiftCheck(startM, endM, s.totalM) };
    },
    year(s: ShiftRow): string {
      const year = s.localDate.slice(0, 4);
      const key = `${s.vehicleId}/${year}`;
      const known = years.get(key);
      if (known !== undefined) return known;
      const inYear = (kind: string) =>
        (
          yearReading.all(userId, s.vehicleId, kind) as { reading_m: number; recorded_at: number }[]
        ).find((r) => localDate(r.recorded_at, timeZone).slice(0, 4) === year)?.reading_m ?? null;
      const trackedM = tracked.pluck().get(userId, s.vehicleId, year) as number;
      const result = yearCheck(inYear('year_start'), inYear('year_end'), trackedM);
      years.set(key, result);
      return result;
    },
  };
}
