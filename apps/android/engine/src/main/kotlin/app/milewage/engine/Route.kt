// Port of packages/track-engine/src/route.ts.
// Stage 8: route simplification for display and replay only. No total is ever computed
// from the simplified route (14 section 5.5). Own Ramer-Douglas-Peucker, no dependency.
package app.milewage.engine

import kotlinx.serialization.Serializable
import kotlin.math.PI

@Serializable
data class RoutePoint(val latE7: Int, val lonE7: Int, val t: Long)

/** Display tolerance: 10 m = 100 dm (14 section 4). The 90-day archive uses 5 m (M6.6). */
const val ROUTE_TOLERANCE_DM: Long = 100

private const val COS_SCALE: Long = 1_000_000

// Decimetres per E7 unit of latitude, on the sphere of haversine.ts: the same operations in the
// same order as `(EARTH_RADIUS_M * Math.PI * 10) / (180 * E7)`.
private val DM_PER_E7: Double = (EARTH_RADIUS_M * PI * 10) / (180.0 * E7)

/**
 * Integer-input RDP in a local equirectangular projection around the first point.
 * The one transcendental call (cos of the first latitude) is V8's cos (FdLibm), rounded to an
 * integer. Coordinate differences are taken in Long before they become doubles: a longitude
 * difference can exceed Int (antimeridian), and JavaScript computes it exactly.
 * First and last points are always kept; the output keeps input order and each point's time.
 */
fun simplifyRoute(points: List<RoutePoint>, toleranceDm: Long = ROUTE_TOLERANCE_DM): List<RoutePoint> {
    val n = points.size
    if (n <= 2) return points.toList()
    val lat0 = points[0].latE7.toLong()
    val lon0 = points[0].lonE7.toLong()
    val cosQ = roundHalfUp(FdLibm.cos((lat0.toDouble() / E7) * (PI / 180)) * COS_SCALE)
    val xs = DoubleArray(n)
    val ys = DoubleArray(n)
    for (i in 0 until n) {
        val p = points[i]
        // (lon - lon0) * cosQ is below 2^53 (3.6e9 * 1e6), so exact in both languages.
        xs[i] = (((p.lonE7 - lon0) * cosQ).toDouble() / COS_SCALE) * DM_PER_E7
        ys[i] = (p.latE7 - lat0).toDouble() * DM_PER_E7
    }
    val tol2 = (toleranceDm * toleranceDm).toDouble()
    val keep = BooleanArray(n)
    keep[0] = true
    keep[n - 1] = true
    val stack = ArrayList<Int>()
    stack.add(0)
    stack.add(n - 1)
    while (stack.isNotEmpty()) {
        val hi = stack.removeAt(stack.size - 1)
        val lo = stack.removeAt(stack.size - 1)
        if (hi - lo < 2) continue
        val ax = xs[lo]
        val ay = ys[lo]
        val dx = xs[hi] - ax
        val dy = ys[hi] - ay
        val len2 = dx * dx + dy * dy
        var worst = -1
        var worst2 = -1.0
        for (i in lo + 1 until hi) {
            val px = xs[i] - ax
            val py = ys[i] - ay
            val d2: Double
            if (len2 == 0.0) {
                d2 = px * px + py * py
            } else {
                val u = (px * dx + py * dy) / len2
                val c = if (u < 0) 0.0 else if (u > 1) 1.0 else u
                val ex = px - c * dx
                val ey = py - c * dy
                d2 = ex * ex + ey * ey
            }
            if (d2 > worst2) {
                worst2 = d2
                worst = i
            }
        }
        if (worst2 > tol2) {
            keep[worst] = true
            stack.add(lo)
            stack.add(worst)
            stack.add(worst)
            stack.add(hi)
        }
    }
    val out = ArrayList<RoutePoint>()
    for (i in 0 until n) if (keep[i]) out.add(points[i])
    return out
}
