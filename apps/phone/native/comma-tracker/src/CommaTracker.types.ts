/** Location cadence passed to startTracking(); every key is optional (defaults in CadenceConfig.kt). */
export interface CadenceConfig {
  /** Fused-location request interval, 1,000 to 300,000 ms. Default 10,000. */
  intervalMs?: number;
  /** Minimum displacement between fixes, 0 to 500 m. Default 20. */
  minDisplacementM?: number;
  /** Batching delay, from intervalMs up to 600,000 ms. Default 30,000. */
  maxUpdateDelayMs?: number;
  /** Confirmed stillness before the GPS radio is released, 30,000 to 1,800,000 ms. Default 150,000. */
  stillTimeoutMs?: number;
}
