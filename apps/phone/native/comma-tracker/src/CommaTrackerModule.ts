import { NativeModule, requireNativeModule } from 'expo';
import type { CadenceConfig } from './CommaTracker.types';

declare class CommaTrackerModule extends NativeModule {
  /**
   * Returns false if the service could not start (invalid cadence, permission missing or
   * background start refused).
   */
  startTracking(cadence?: CadenceConfig): boolean;
  stopTracking(): void;
  /** Opens the system battery-optimization settings list. Returns false if it cannot open. */
  requestBatteryOptimizationSettings(): boolean;
  /** Total GPS distance accumulated by the native tracking service this session, in metres. */
  getActiveDistanceMeters(): number;
}

export default requireNativeModule<CommaTrackerModule>('CommaTracker');
