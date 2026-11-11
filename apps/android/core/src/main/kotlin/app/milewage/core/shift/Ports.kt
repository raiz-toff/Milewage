package app.milewage.core.shift

import app.milewage.core.api.Segmenter
import app.milewage.core.pairing.Flags
import app.milewage.core.tracking.Interruption

/**
 * The tracker as the shift model needs it. `:app` implements it on `TrackingController` (the shift
 * model cannot depend on `:tracking`): `start` is `startShift(id, startedAt) == STARTED`, `stop` is
 * `stopShift()`, `recording` is the controller's status `shiftClientId` while it records,
 * `interruptions` is `interruptions(id)`, `gnssOffsetMs` is `gnssOffsetMs()`.
 */
interface Recorder {
    /**
     * Starts recording [shiftClientId] from [startedAt]. False when it could not
     * (no location permission, Android refused the service).
     */
    suspend fun start(shiftClientId: String, startedAt: Long): Boolean

    /** Stops recording. Every fix it stored stays. */
    suspend fun stop()

    /** The shift being recorded right now, or null. */
    suspend fun recording(): String?

    /** The interruptions the tracker logged for the shift (service restarted, location off, permission lost). */
    suspend fun interruptions(shiftClientId: String): List<Interruption>

    /** `fix time - phone time` of the last GNSS fix of the last 10 minutes, or null. */
    fun gnssOffsetMs(): Long?

    companion object {
        /** No tracker (tests, previews, the tracking module off): records nothing. */
        val NONE = object : Recorder {
            override suspend fun start(shiftClientId: String, startedAt: Long) = true

            override suspend fun stop() = Unit

            override suspend fun recording(): String? = null

            override suspend fun interruptions(shiftClientId: String): List<Interruption> = emptyList()

            override fun gnssOffsetMs(): Long? = null
        }
    }
}

/** What a shift is started with: from the paired server's cached settings. Null when not paired. */
data class ShiftContext(
    /** The server's tracking module: without it the tracker is not started (08 F22). */
    val tracking: Boolean,
    val segmenter: Segmenter,
    /** The instance's IANA zone: local dates are never the phone's. */
    val timezone: String,
    /** The paired server's instance id: a new shift is bound to it (`ShiftRecord.instanceId`). */
    val instanceId: String? = null,
) {
    companion object {
        fun of(flags: Flags, instanceId: String? = null) = ShiftContext(flags.tracking, flags.segmenter, flags.timezone, instanceId)
    }
}

/** The battery at shift start and end, for `shift.summary`. Null when the phone cannot say. */
fun interface BatteryPort {
    suspend fun read(): BatteryReading?
}
