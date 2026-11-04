package expo.modules.commatracker

import kotlin.math.roundToLong

/** Pure conversions from a platform fix to the stored units (07 section 1): e7 degrees, metres, dm/s. */
object PointMapper {
    /** Accuracy stored when the provider reports none: far above the engine's 50 m limit, so it is dropped there. */
    const val UNKNOWN_ACCURACY_M = 9_999L

    fun toPoint(
        shiftClientId: String,
        timeMs: Long,
        lat: Double,
        lon: Double,
        accuracyM: Float?,
        speedMps: Float?,
        bearingDeg: Float?,
        altitudeM: Double?,
    ) = BufferPoint(
        seq = 0,
        shiftClientId = shiftClientId,
        recordedAt = timeMs,
        latE7 = (lat * 1e7).roundToLong(),
        lonE7 = (lon * 1e7).roundToLong(),
        accuracyM = accuracyM?.let { it.roundToLong() } ?: UNKNOWN_ACCURACY_M,
        speedDmps = speedMps?.let { (it * 10.0).roundToLong() },
        bearingDeg = bearingDeg?.let { it.roundToLong() },
        altitudeM = altitudeM?.roundToLong(),
    )

    /** `fix_time − now` (15 section 10): add it to the device clock to get GNSS time. */
    fun gnssOffsetMs(fixTimeMs: Long, nowMs: Long): Long = fixTimeMs - nowMs
}
