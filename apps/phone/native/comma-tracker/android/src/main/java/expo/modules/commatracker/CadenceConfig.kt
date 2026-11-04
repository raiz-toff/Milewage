package expo.modules.commatracker

/**
 * Location cadence, passed from JS at start() so tuning needs no native rebuild (09 section 5.2).
 * Defaults are Comma's proven values (02 section 2.2). Pure Kotlin: unit-tested with JUnit.
 */
data class CadenceConfig(
    val intervalMs: Long = 10_000L,
    val minDisplacementM: Float = 20f,
    val maxUpdateDelayMs: Long = 30_000L,
    val stillTimeoutMs: Long = 150_000L,
) {
    init {
        require(intervalMs in 1_000L..300_000L) { "intervalMs out of range" }
        require(minDisplacementM in 0f..500f) { "minDisplacementM out of range" }
        require(maxUpdateDelayMs in intervalMs..600_000L) { "maxUpdateDelayMs out of range" }
        require(stillTimeoutMs in 30_000L..1_800_000L) { "stillTimeoutMs out of range" }
    }

    /** Flat map for SharedPreferences, so a restarted service finds the same config. */
    fun toMap(): Map<String, Number> = mapOf(
        "intervalMs" to intervalMs,
        "minDisplacementM" to minDisplacementM,
        "maxUpdateDelayMs" to maxUpdateDelayMs,
        "stillTimeoutMs" to stillTimeoutMs,
    )

    companion object {
        /** Missing or null keys take defaults; a non-number or out-of-range value throws. */
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
            )
        }
    }
}
