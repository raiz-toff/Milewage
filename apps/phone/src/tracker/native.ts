import type { Tracker } from './types';

/**
 * The Android module as a `Tracker`. Loaded lazily so tests and non-Android builds never touch
 * the native module; the module's methods already have this exact shape.
 */
export function createNativeTracker(): Tracker {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('../../native/comma-tracker').default as Tracker;
  return module;
}

/** A `Tracker` that loads the native module on first method call, not at construction. */
export function createLazyNativeTracker(): Tracker {
  let tracker: Tracker | null = null;
  return new Proxy({} as Tracker, {
    get(_target, prop) {
      tracker ??= createNativeTracker();
      const member = (tracker as unknown as Record<string | symbol, unknown>)[prop];
      return typeof member === 'function' ? member.bind(tracker) : member;
    },
  });
}

/** Phone state the tracker module also reads. Absent on an APK built before these were added. */
interface DeviceReads {
  locationEnabled?: () => boolean | null;
  battery?: () => { level: number; charging: boolean } | null;
}

const deviceReads = () => createNativeTracker() as unknown as DeviceReads;

/** The system Location switch (`LocationManagerCompat.isLocationEnabled`); null when unknown. */
export const nativeLocationSwitch = async (): Promise<boolean | null> =>
  deviceReads().locationEnabled?.() ?? null;

/** The battery from `BatteryManager`; null when unknown. */
export const nativeBattery = async (): Promise<{ level: number; charging: boolean } | null> =>
  deviceReads().battery?.() ?? null;
