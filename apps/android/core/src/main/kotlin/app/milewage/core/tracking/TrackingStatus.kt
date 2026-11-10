package app.milewage.core.tracking

/** What the tracking service is doing. */
enum class TrackingMode {
    /** Not running: no shift, detection off (or the service could not start). */
    STOPPED,

    /** A shift is recording. */
    RECORDING,

    /** No shift; drive detection is watching for a drive. */
    WATCHING,
}

/** Something that stops tracking from working, for the app to explain (no coordinates). */
enum class TrackingProblem {
    /** No fine location permission (or only approximate): nothing can be recorded. */
    NO_LOCATION_PERMISSION,

    /** No "Allow all the time": recording may stop with the screen off; detection cannot run. */
    NO_BACKGROUND_LOCATION,

    /** The phone's Location switch is off. */
    LOCATION_OFF,

    /** The phone has neither a GNSS receiver nor network positions. */
    NO_LOCATION_PROVIDER,

    /** Android did not allow the service to start (a start from the background). */
    START_NOT_ALLOWED,

    /** The application does not provide the tracking dependencies (a wiring bug). */
    NOT_WIRED,
}

/** The tracker's state for the app's screens. Never holds a coordinate. */
data class TrackingStatus(
    val mode: TrackingMode = TrackingMode.STOPPED,
    val shiftClientId: String? = null,
    val startedAt: Long? = null,
    /** The live running distance in whole metres (display only, see [LiveDistance]). */
    val distanceM: Long = 0,
    /** FULL or LOW while recording; null otherwise. */
    val power: PowerLevel? = null,
    /** Fixes stored for the shift since the service started (or restarted). */
    val storedFixes: Int = 0,
    /** Phone time of the last fix of any kind. */
    val lastFixAt: Long? = null,
    val detection: DetectorState = DetectorState.OFF,
    /** `fix_time - phone time` of the last GNSS fix (15 section 10), and when it was measured. */
    val gnssOffsetMs: Long? = null,
    val gnssOffsetAt: Long? = null,
    val problem: TrackingProblem? = null,
) {
    /** The offset if measured in the last 10 minutes, as the Expo module's `gnssOffsetMs()`. */
    fun freshGnssOffsetMs(nowMs: Long): Long? {
        val at = gnssOffsetAt ?: return null
        return if (nowMs - at > ClockSkew.OFFSET_FRESH_MS) null else gnssOffsetMs
    }
}
