package app.milewage.core.tracking

import kotlin.math.cos
import kotlin.random.Random

/**
 * A phone moving on a flat local grid around London, producing [Sample]s on the phone clock.
 * Distances in metres north and east of the start.
 */
class Sim(seed: Int = 42) {
    var timeMs = 1_700_000_000_000L
    var northM = 0.0
    var eastM = 0.0
    private val random = Random(seed)
    private val lat0 = 51.5
    private val lon0 = -0.12

    fun lat(n: Double) = lat0 + Math.toDegrees(n / Geo.EARTH_RADIUS_M)
    fun lon(e: Double) = lon0 + Math.toDegrees(e / (Geo.EARTH_RADIUS_M * cos(Math.toRadians(lat0))))

    fun sample(
        accuracy: Float? = 8f,
        speed: Float? = null,
        jitterM: Double = 0.0,
        provider: String = RawLocation.GPS,
    ): Sample {
        val jn = if (jitterM > 0) random.nextDouble(-jitterM, jitterM) else 0.0
        val je = if (jitterM > 0) random.nextDouble(-jitterM, jitterM) else 0.0
        val r = RawLocation(provider, timeMs, null, lat(northM + jn), lon(eastM + je), accuracy, speed, null, null)
        return Sample(r, timeMs)
    }

    fun randomSpeed(max: Double): Float = random.nextDouble(0.0, max).toFloat()
}
