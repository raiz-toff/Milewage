package app.milewage.phone.logic

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * The route sketch's projection (no map tiles, no network; 15 section 4: no basemap offline): the
 * points fitted into a box with [pad] around them, north up, longitude scaled by the cosine of the
 * middle latitude so the shape is not stretched, and the whole route centred. Stops are projected
 * with the same frame. A port of the Expo app's `RouteView` maths.
 */
class RouteProjection private constructor(
    private val minX: Double,
    private val maxY: Double,
    private val k: Double,
    private val scale: Double,
    private val offX: Double,
    private val offY: Double,
) {
    /** x, y in the box for a point in degrees x 1e7. */
    fun project(latE7: Long, lonE7: Long): Pair<Float, Float> {
        val x = lonE7 / 1e7 * k
        val y = latE7 / 1e7
        return (offX + (x - minX) * scale).toFloat() to (offY + (maxY - y) * scale).toFloat()
    }

    companion object {
        /** Null with fewer than two points: nothing to draw. */
        fun fit(points: List<Pair<Long, Long>>, width: Float, height: Float, pad: Float): RouteProjection? {
            if (points.size < 2 || width <= 2 * pad || height <= 2 * pad) return null
            val lats = points.map { it.first / 1e7 }
            val midLat = (lats.min() + lats.max()) / 2
            val k = cos(midLat * PI / 180)
            val xs = points.map { it.second / 1e7 * k }
            val minX = xs.min()
            val maxY = lats.max()
            val realX = xs.max() - minX
            val realY = maxY - lats.min()
            // A route that never moved is a dot in the middle, not a division by zero.
            val scale = min((width - 2 * pad) / max(realX, 1e-9), (height - 2 * pad) / max(realY, 1e-9))
            val offX = (width - realX * scale) / 2
            val offY = (height - realY * scale) / 2
            return RouteProjection(minX, maxY, k, scale, offX, offY)
        }
    }
}
