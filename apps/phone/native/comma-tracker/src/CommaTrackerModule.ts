import { NativeModule, requireNativeModule } from 'expo';
import type { CadenceConfig, NativePoint } from './CommaTracker.types';

declare class CommaTrackerModule extends NativeModule {
  /**
   * Starts the foreground service for a shift. Returns false if it could not start (blank
   * shift id, invalid cadence, permission missing or background start refused).
   */
  start(shiftClientId: string, cadence?: CadenceConfig): boolean;
  stop(): void;
  isTracking(): boolean;
  /** Oldest PENDING points first. */
  readPending(limit: number): NativePoint[];
  /** Marks points UPLOADED; returns how many changed. */
  markUploaded(seqs: number[]): number;
  /** Moves permanently refused points to quarantine; returns how many moved. */
  markRejected(seqs: number[]): number;
  /** Deletes UPLOADED points acknowledged before the cutoff. Never deletes a PENDING point. */
  evictUploaded(olderThanMs: number): number;
  /** Latest `fix_time - now` in ms, or null when no fix arrived in the last 10 minutes. */
  gnssOffsetMs(): number | null;
  /** Opens the system battery-optimization settings list. Returns false if it cannot open. */
  requestBatteryOptimizationSettings(): boolean;
}

export default requireNativeModule<CommaTrackerModule>('CommaTracker');
