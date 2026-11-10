package app.milewage.core.tracking

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The running distance of a shift, for the notification and the status. Exactly stages 1 to 3 of
 * the engine (algorithm version 4) as `createLiveAccumulator` runs them one fix at a time
 * (packages/track-engine/src/live.ts with gate.ts, qualify.ts, haversine.ts, normalize.ts):
 *
 * 1. a fix more than 5 minutes before the shift start is ignored, and a `seq` already seen;
 * 2. a fix with an accuracy radius over 50 m is skipped;
 * 3. against the last accepted fix (the anchor): a fix not later than the anchor is dropped, an
 *    implied speed over 42 m/s is a glitch, and a move under `max(20 m, 10 x the worse accuracy)`
 *    (ADR 0006) is jitter; otherwise the chord is counted and the fix becomes the anchor.
 *
 * Display only, never stored: the shift's real total comes from the engine at the end.
 *
 * The haversine uses `kotlin.math`, which on the JVM may differ from V8 in the last bit of a
 * double; the result is rounded to whole decimetres, so that only matters at an exact half.
 *
 * TODO(engine): switch to `:engine`'s `createLiveAccumulator` once the port lands, and delete this.
 */
class LiveDistance(private val startedAt: Long) {
    private val seen = HashSet<Long>()
    private var anchor: RecordedFix? = null
    private var totalDm = 0L

    fun push(f: RecordedFix) {
        if (f.recordedAt < startedAt - WINDOW_BEFORE_MS) return // stage 1
        if (!seen.add(f.seq)) return
        if (f.accuracyM > MAX_ACCURACY_M) return // stage 2
        val a = anchor
        if (a != null) { // stage 3
            val dtMs = f.recordedAt - a.recordedAt
            if (dtMs <= 0) return
            val dDm = Geo.haversineDm(a.latE7, a.lonE7, f.latE7, f.lonE7)
            if (dDm * 1000 > MAX_SPEED_DMPS * dtMs) return
            if (dDm < minMoveDm(a.accuracyM, f.accuracyM)) return
            totalDm += dDm
        }
        anchor = f
    }

    /** Whole metres, rounded once (14 section 9.1 rule 2): `divRound(dm, 10)`. */
    fun runningTotalM(): Long = Math2.divRound(totalDm, 10)

    companion object {
        const val WINDOW_BEFORE_MS = 5 * 60_000L
        const val MAX_ACCURACY_M = 50L
        const val MAX_SPEED_DMPS = 420L
        const val MIN_MOVE_DM = 200L

        /** As `minMoveDm` in gate.ts (ADR 0006): max(20 m, the worse of the two accuracies), in dm. */
        fun minMoveDm(anchorAccuracyM: Long, fixAccuracyM: Long): Long =
            maxOf(MIN_MOVE_DM, maxOf(anchorAccuracyM, fixAccuracyM) * 10)
    }
}

/** Integer helpers of packages/track-engine/src/ints.ts that the live rule needs. */
internal object Math2 {
    /** `Math.floor((2 * num + den) / (2 * den))` for a positive [den]: nearest, halves up. */
    fun divRound(num: Long, den: Long): Long = (2 * num + den).floorDiv(2 * den)
}

/** Distances on the sphere, as packages/track-engine/src/haversine.ts. */
object Geo {
    const val EARTH_RADIUS_M = 6_371_000.0

    /** Haversine between two E7 points, rounded once to whole decimetres (half up). */
    fun haversineDm(aLatE7: Long, aLonE7: Long, bLatE7: Long, bLonE7: Long): Long {
        val rad = PI / 180
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

    /** Metres between two E7 points (for the detectors' thresholds, not for any stored distance). */
    fun metres(aLatE7: Long, aLonE7: Long, bLatE7: Long, bLonE7: Long): Double =
        haversineDm(aLatE7, aLonE7, bLatE7, bLonE7) / 10.0
}
