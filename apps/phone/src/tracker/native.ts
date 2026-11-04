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
