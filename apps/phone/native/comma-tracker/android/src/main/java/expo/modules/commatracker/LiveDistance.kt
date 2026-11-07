package expo.modules.commatracker

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The running distance of a shift, for the notification. The same stages 1-3 as the shared engine's
 * `createLiveAccumulator` (packages/track-engine/src/live.ts), on the same stored integers, so the
 * notification and the app's Home screen show the same number. Written out here because the app's
 * JavaScript timers stop while the app is in the background, and the notification must keep going.
 * Like the JS one it is approximate and never stored: the shift's real total comes from the engine.
 */
class LiveDistance(private val startedAt: Long) {
    private val seen = HashSet<Long>()
    private var anchor: BufferPoint? = null
    private var totalDm = 0L

    fun push(p: BufferPoint) {
        if (p.recordedAt < startedAt - WINDOW_BEFORE_MS) return // stage 1
        if (!seen.add(p.seq)) return
        if (p.accuracyM > MAX_ACCURACY_M) return // stage 2
        val a = anchor
        if (a != null) { // stage 3
            val dtMs = p.recordedAt - a.recordedAt
            if (dtMs <= 0) return
            val dDm = haversineDm(a.latE7, a.lonE7, p.latE7, p.lonE7)
            if (dDm * 1000 > MAX_SPEED_DMPS * dtMs) return
            if (dDm < MIN_MOVE_DM) return
            totalDm += dDm
        }
        anchor = p
    }

    /** Whole metres, rounded once (14 section 9.1 rule 2). */
    fun runningTotalM(): Long = floor((2.0 * totalDm + 10) / 20).toLong()

    companion object {
        const val WINDOW_BEFORE_MS = 5 * 60_000L
        const val MAX_ACCURACY_M = 50L
        const val MAX_SPEED_DMPS = 420L
        const val MIN_MOVE_DM = 200L
        private const val EARTH_RADIUS_M = 6_371_000.0

        /** As `haversineDm` in the engine: degrees from e7, rounded once to whole decimetres. */
        fun haversineDm(aLatE7: Long, aLonE7: Long, bLatE7: Long, bLonE7: Long): Long {
            val rad = Math.PI / 180
            val lat1 = aLatE7 / 1e7 * rad
            val lat2 = bLatE7 / 1e7 * rad
            val dLat = lat2 - lat1
            val dLon = (bLonE7 / 1e7 - aLonE7 / 1e7) * rad
            val s1 = sin(dLat / 2)
            val s2 = sin(dLon / 2)
            val a = s1 * s1 + cos(lat1) * cos(lat2) * s2 * s2
            val c = 2 * atan2(sqrt(a), sqrt(1 - a))
            return floor(EARTH_RADIUS_M * c * 10 + 0.5).toLong()
        }
    }
}
