import type { KeyValueStore } from '../pairing/pairing';
import { localDate, type ShiftStore } from '../store/shiftStore';

/** Comma asks again once the last check is 14 days old (commaApp `app/(tabs)/index.tsx`). */
export const ODOMETER_EVERY_MS = 14 * 24 * 60 * 60 * 1000;

const key = (vehicleId: number) => `odometer.checked.${vehicleId}`;

/**
 * Whether to ask for the odometer after a shift ends: Comma's cadence (`docs/features/mileage-
 * tracking.md`, "Odometer reconciliation"): once a month and whenever 14 days have passed. Comma
 * asks on the 1st of the month; a driver who does not work on the 1st is asked after the first
 * shift of the month instead, so every month, December and January included, gets a reading
 * (CRA: odometer at the start and end of the tax year). Never asked before: ask now, the baseline.
 */
export function odometerDue(o: { now: number; zone: string; lastCheck: number | null }): boolean {
  if (o.lastCheck === null) return true;
  if (o.now - o.lastCheck >= ODOMETER_EVERY_MS) return true;
  return localDate(o.lastCheck, o.zone).slice(0, 7) !== localDate(o.now, o.zone).slice(0, 7);
}

/**
 * The last check of a vehicle's odometer: its newest reading on any shift, or the last time the
 * driver answered or dismissed the prompt on this phone, whichever is later.
 */
export async function lastOdometerCheck(
  shifts: Pick<ShiftStore, 'lastOdometerAt'>,
  plain: KeyValueStore,
  vehicleId: number,
): Promise<number | null> {
  const read = await shifts.lastOdometerAt(vehicleId);
  const seen = Number(await plain.get(key(vehicleId)));
  const asked = Number.isFinite(seen) && seen > 0 ? seen : null;
  if (read === null) return asked;
  return asked === null ? read : Math.max(read, asked);
}

/** Answered or dismissed: the prompt stays away until the next one is due. */
export function markOdometerChecked(plain: KeyValueStore, vehicleId: number, at: number) {
  return plain.set(key(vehicleId), String(at));
}
