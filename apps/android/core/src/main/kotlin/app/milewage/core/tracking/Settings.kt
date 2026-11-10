package app.milewage.core.tracking

/**
 * Location cadence during a shift, persisted ([TrackingSettingsStore]) so a restarted service uses
 * the same values. A port of the Expo tracker's `CadenceConfig` (same validation style, same map
 * round trip) with the native app's defaults (owner decision 2026-11-10):
 *
 * - [intervalMs] 5 s (was 10 s) and [minDisplacementM] 0 (was 20 m). The platform's minimum
 *   distance filter drops fixes while the phone is still, and stop detection (track-engine
 *   `stops.ts`) reads exactly those fixes to find a dwell, so none is filtered here.
 * - [maxUpdateDelayMs] 15 s: Android 12+ may batch fixes up to this long when the GNSS chip
 *   supports batching, so the processor sleeps between deliveries. Every fix is still delivered
 *   and stored; only the notification lags by up to this much.
 * - [stillTimeoutMs] 150 s (unchanged): still that long, the GPS drops to the low-power watch.
 *   The engine's stop "wake-up rule" is built on this value (`STOP_WAKE_GAP_MS`).
 * - [lowPowerIntervalMs] 60 s: the sparse GPS and network interval of the low-power watch. On
 *   AOSP an interval of 10 s or more makes the GNSS provider duty-cycle (fix, off, alarm, fix).
 */
data class CadenceConfig(
    val intervalMs: Long = 5_000L,
    val minDisplacementM: Float = 0f,
    val maxUpdateDelayMs: Long = 15_000L,
    val stillTimeoutMs: Long = 150_000L,
    val lowPowerIntervalMs: Long = 60_000L,
) {
    init {
        require(intervalMs in 1_000L..300_000L) { "intervalMs out of range" }
        require(minDisplacementM in 0f..500f) { "minDisplacementM out of range" }
        require(maxUpdateDelayMs in intervalMs..600_000L) { "maxUpdateDelayMs out of range" }
        require(stillTimeoutMs in 30_000L..1_800_000L) { "stillTimeoutMs out of range" }
        require(lowPowerIntervalMs in 15_000L..600_000L) { "lowPowerIntervalMs out of range" }
    }

    /** Flat map for key-value storage, so a restarted service finds the same config. */
    fun toMap(): Map<String, Number> = mapOf(
        "intervalMs" to intervalMs,
        "minDisplacementM" to minDisplacementM,
        "maxUpdateDelayMs" to maxUpdateDelayMs,
        "stillTimeoutMs" to stillTimeoutMs,
        "lowPowerIntervalMs" to lowPowerIntervalMs,
    )

    companion object {
        /** Missing or null keys take defaults; a non-number, non-finite or out-of-range value throws. */
        fun fromMap(map: Map<String, Any?>?): CadenceConfig {
            val d = CadenceConfig()
            if (map == null) return d
            fun num(key: String): Number? {
                val v = map[key] ?: return null
                require(v is Number) { "$key must be a number" }
                require(v.toDouble().isFinite()) { "$key must be finite" }
                return v
            }
            return CadenceConfig(
                intervalMs = num("intervalMs")?.toLong() ?: d.intervalMs,
                minDisplacementM = num("minDisplacementM")?.toFloat() ?: d.minDisplacementM,
                maxUpdateDelayMs = num("maxUpdateDelayMs")?.toLong() ?: d.maxUpdateDelayMs,
                stillTimeoutMs = num("stillTimeoutMs")?.toLong() ?: d.stillTimeoutMs,
                lowPowerIntervalMs = num("lowPowerIntervalMs")?.toLong() ?: d.lowPowerIntervalMs,
            )
        }
    }
}

/**
 * Everything the driver or the app can tune about tracking.
 *
 * - [detectionEnabled]: the "You seem to be driving. Start a shift?" prompt. Opt-in, off until the
 *   driver turns it on in Settings (it needs "Allow all the time" location).
 * - [nudgeAfterMs]: the "Still on shift?" nudge after this long without moving during a shift;
 *   0 turns it off. Default 30 minutes, at least 10 minutes, at most 4 hours.
 */
data class TrackingSettings(
    val cadence: CadenceConfig = CadenceConfig(),
    val detectionEnabled: Boolean = false,
    val nudgeAfterMs: Long = DEFAULT_NUDGE_MS,
) {
    init {
        require(nudgeAfterMs == 0L || nudgeAfterMs in MIN_NUDGE_MS..MAX_NUDGE_MS) { "nudgeAfterMs out of range" }
    }

    fun toMap(): Map<String, Any> =
        cadence.toMap() + mapOf("detectionEnabled" to detectionEnabled, "nudgeAfterMs" to nudgeAfterMs)

    companion object {
        const val DEFAULT_NUDGE_MS = 30 * 60_000L
        const val MIN_NUDGE_MS = 10 * 60_000L
        const val MAX_NUDGE_MS = 4 * 60 * 60_000L

        /**
         * Reads a stored map. Unlike [CadenceConfig.fromMap] it never throws: a bad stored value
         * must not stop a shift from recording, so the whole cadence falls back to the defaults
         * and a bad nudge time to its default.
         */
        fun fromMap(map: Map<String, Any?>?): TrackingSettings {
            if (map == null) return TrackingSettings()
            val cadence = try {
                CadenceConfig.fromMap(map)
            } catch (_: IllegalArgumentException) {
                CadenceConfig()
            }
            val nudge = (map["nudgeAfterMs"] as? Number)?.toLong()
                ?.takeIf { it == 0L || it in MIN_NUDGE_MS..MAX_NUDGE_MS } ?: DEFAULT_NUDGE_MS
            return TrackingSettings(cadence, map["detectionEnabled"] == true, nudge)
        }
    }
}
