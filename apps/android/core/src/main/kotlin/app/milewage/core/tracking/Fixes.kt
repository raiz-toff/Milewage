package app.milewage.core.tracking

import kotlin.math.roundToLong

/**
 * One location sample as the platform delivered it, before it is stored. Platform-neutral: the
 * Android layer fills it from `android.location.Location`, a test from numbers.
 *
 * Two clocks. [timeMs] is the fix's own time (`Location.getTime()`): GNSS time for the `gps`
 * provider, the phone's clock for most others. [elapsedRealtimeMs] is when the fix was made on the
 * phone's monotonic clock (`Location.getElapsedRealtimeNanos() / 1e6`), which does not jump when
 * the wall clock is set; it lets the phone's wall-clock time at the fix be worked out even when the
 * fix arrives late (batched delivery), see [phoneTimeAt].
 */
data class RawLocation(
    /** "gps", "network", "fused", "passive" source name as the platform reports it. */
    val provider: String,
    val timeMs: Long,
    val elapsedRealtimeMs: Long?,
    val lat: Double,
    val lon: Double,
    val accuracyM: Float?,
    val speedMps: Float?,
    val bearingDeg: Float?,
    val altitudeM: Double?,
) {
    /**
     * The phone's wall clock when the fix was made: the wall clock now, minus how long ago the fix
     * was made on the monotonic clock. Without an elapsed-realtime stamp, the wall clock now.
     */
    fun phoneTimeAt(nowWallMs: Long, nowElapsedMs: Long): Long {
        val made = elapsedRealtimeMs ?: return nowWallMs
        val age = nowElapsedMs - made
        return if (age < 0) nowWallMs else nowWallMs - age
    }

    /** True for a fix from the satellite receiver (GNSS time in [timeMs]). */
    val isGnss: Boolean get() = provider == GPS

    companion object {
        const val GPS = "gps"
        const val NETWORK = "network"
        const val PASSIVE = "passive"
        const val FUSED = "fused"
    }
}

/**
 * One stored fix: the row of the phone's points table (`telemetry_buffer` in the Expo app's
 * `tracker.db`, `TrackerBuffer.kt`; the wire shape of plan 08 section 5) plus three local-only
 * fields. Field meanings are those of `BufferPoint` and `apps/phone/src/tracker/types.ts`
 * `TrackerPoint`, so the server contract is unchanged:
 *
 * - [seq]: device-assigned by [FixStore.append], strictly increasing, never reused (0 before).
 * - [recordedAt]: the fix's own time, epoch ms (`Location.getTime()`, GNSS time for `gps`).
 * - [latE7], [lonE7]: degrees x 1e7, rounded half up.
 * - [accuracyM]: horizontal accuracy radius in whole metres; [UNKNOWN_ACCURACY_M] when unknown.
 * - [speedDmps]: reported speed in decimetres per second, or null.
 * - [bearingDeg], [altitudeM]: whole degrees and whole metres, or null.
 *
 * Local only, never sent (the wire has no field for them): [provider], [elapsedRealtimeMs] and
 * [phoneTimeMs] (the phone's wall clock at the fix), so the clock skew of plan 14 section 15
 * (`clockSkewMs`, phone clock minus GNSS time) can be measured from stored fixes, see [ClockSkew].
 */
data class RecordedFix(
    val seq: Long,
    val shiftClientId: String,
    val recordedAt: Long,
    val latE7: Long,
    val lonE7: Long,
    val accuracyM: Long,
    val speedDmps: Long?,
    val bearingDeg: Long?,
    val altitudeM: Long?,
    val provider: String? = null,
    val elapsedRealtimeMs: Long? = null,
    val phoneTimeMs: Long? = null,
) {
    companion object {
        /** Accuracy stored when the provider reports none: far above the engine's 50 m limit, so it is dropped there. */
        const val UNKNOWN_ACCURACY_M = 9_999L
    }
}

/**
 * Pure conversions from a platform sample to the stored units (07 section 1): E7 degrees, metres,
 * dm/s. A port of the Expo tracker's `PointMapper` with the same rounding (`roundToLong`, which is
 * half up like the engine's `roundHalfUp`). One difference: a value that is not finite (NaN,
 * infinity) is stored as unknown instead of throwing and losing the whole fix.
 */
object FixMapper {
    /** Null when the coordinates themselves are unusable (not finite or out of range). */
    fun toRecordedFix(shiftClientId: String, raw: RawLocation, phoneTimeMs: Long?): RecordedFix? {
        if (!raw.lat.isFinite() || !raw.lon.isFinite()) return null
        if (raw.lat !in -90.0..90.0 || raw.lon !in -180.0..180.0) return null
        return RecordedFix(
            seq = 0,
            shiftClientId = shiftClientId,
            recordedAt = raw.timeMs,
            latE7 = toE7(raw.lat),
            lonE7 = toE7(raw.lon),
            accuracyM = raw.accuracyM?.takeIf { it.isFinite() }?.roundToLong() ?: RecordedFix.UNKNOWN_ACCURACY_M,
            speedDmps = raw.speedMps?.takeIf { it.isFinite() }?.let { (it * 10.0).roundToLong() },
            bearingDeg = raw.bearingDeg?.takeIf { it.isFinite() }?.roundToLong(),
            altitudeM = raw.altitudeM?.takeIf { it.isFinite() }?.roundToLong(),
            provider = raw.provider,
            elapsedRealtimeMs = raw.elapsedRealtimeMs,
            phoneTimeMs = phoneTimeMs,
        )
    }

    fun toE7(deg: Double): Long = (deg * 1e7).roundToLong()

    /**
     * `fix_time - phone time at the fix` (15 section 10): add it to the phone's clock to get GNSS
     * time. The Expo tracker used the phone's clock when the fix arrived; with batched delivery
     * that is late, so the phone time at the fix is used ([RawLocation.phoneTimeAt]). Equal when
     * the fix is delivered at once.
     */
    fun gnssOffsetMs(fixTimeMs: Long, phoneTimeAtFixMs: Long): Long = fixTimeMs - phoneTimeAtFixMs
}

/**
 * The clock skew the engine reads (`ShiftInput.clockSkewMs`, 14 section 15): the median of
 * `phone clock - GNSS time` over a shift's GNSS fixes. Fixes from other providers carry the phone's
 * own clock and would pull the median to zero, so only `gps` fixes with a phone time count.
 */
object ClockSkew {
    /** Null when no GNSS fix has a phone time. Lower middle for an even count, as `medianMs`. */
    fun medianPhoneMinusGnssMs(fixes: List<RecordedFix>): Long? {
        val samples = fixes
            .filter { it.provider == RawLocation.GPS && it.phoneTimeMs != null }
            .map { it.phoneTimeMs!! - it.recordedAt }
            .sorted()
        if (samples.isEmpty()) return null
        return samples[(samples.size - 1) / 2]
    }

    /** `gnssOffsetMs` is stale after 10 minutes without a fix (the Expo module's rule). */
    const val OFFSET_FRESH_MS = 10 * 60_000L
}

/**
 * Drops a sample that is the exact same fix delivered twice: the `passive` listener also receives
 * the `gps` fixes this app asked for. Same provider, same time, same coordinates: the same fix.
 * Anything that differs in any of those is a different fix and passes.
 */
class DuplicateFilter(private val remember: Int = 32) {
    private val recent = ArrayDeque<String>()

    fun isNew(raw: RawLocation): Boolean {
        val key = "${raw.provider}|${raw.timeMs}|${raw.lat}|${raw.lon}"
        if (key in recent) return false
        recent.addLast(key)
        while (recent.size > remember) recent.removeFirst()
        return true
    }
}
