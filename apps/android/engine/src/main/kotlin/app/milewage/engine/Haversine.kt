// Port of packages/track-engine/src/haversine.ts.
//
// The same expression, operation for operation, with V8's own sin, cos and atan2 (FdLibm.kt) in
// place of the platform's: kotlin.math on the JVM may use CPU intrinsics that differ from V8 in
// the last bit, and one bit can move a result across a half decimetre. sqrt, +, -, * and / are
// correctly rounded on every platform. HaversineCrossCheckTest compares the raw double, not
// only the rounded decimetres, with Node on 250,000 pairs.
package app.milewage.engine

import kotlin.math.PI
import kotlin.math.sqrt

/** Earth radius in metres, as in Comma and 14 section 9.1 rule 5. */
const val EARTH_RADIUS_M: Int = 6_371_000

/**
 * The haversine distance in decimetres before rounding: `EARTH_RADIUS_M * c * 10` of the
 * TypeScript, bit for bit. Exposed for the cross-check tests.
 */
internal fun haversineRawDm(aLatE7: Int, aLonE7: Int, bLatE7: Int, bLonE7: Int): Double {
    val rad = PI / 180
    val lat1 = e7ToDeg(aLatE7) * rad
    val lat2 = e7ToDeg(bLatE7) * rad
    val dLat = lat2 - lat1
    val dLon = (e7ToDeg(bLonE7) - e7ToDeg(aLonE7)) * rad
    val s1 = FdLibm.sin(dLat / 2)
    val s2 = FdLibm.sin(dLon / 2)
    val a = s1 * s1 + FdLibm.cos(lat1) * FdLibm.cos(lat2) * s2 * s2
    val c = 2 * FdLibm.atan2(sqrt(a), sqrt(1 - a))
    return EARTH_RADIUS_M * c * 10
}

/**
 * Haversine distance between two E7 points, rounded once to whole decimetres.
 * The formula is written out here, not taken from a library (14 section 9.1).
 */
fun haversineDm(aLatE7: Int, aLonE7: Int, bLatE7: Int, bLonE7: Int): Long =
    roundHalfUp(haversineRawDm(aLatE7, aLonE7, bLatE7, bLonE7))
