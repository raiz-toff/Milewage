package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Expected values come from the TypeScript engine (packages/track-engine, algorithm version 4):
 * `createLiveAccumulator` and `haversineDm` run with vite-node over the same fixes.
 */
class LiveDistanceTest {
    private val start = 1_700_000_000_000L

    private fun p(seq: Long, dt: Long, lat: Long, lon: Long, acc: Long) =
        RecordedFix(seq, "s", start + dt, lat, lon, acc, null, null, null)

    @Test
    fun `counts like the engine's live accumulator`() {
        // One before the window, an inaccurate fix, a speed spike, a step under 20 m, a duplicate seq.
        val d = LiveDistance(start)
        listOf(
            p(1, -400_000, 436532000, -793832000, 5),
            p(2, 0, 436532000, -793832000, 5),
            p(3, 10_000, 436540000, -793820000, 8),
            p(4, 20_000, 436560000, -793800000, 80),
            p(5, 30_000, 436560000, -793790000, 6),
            p(6, 31_000, 437000000, -793000000, 6),
            p(7, 40_000, 436560500, -793789500, 6),
            p(8, 60_000, 436600000, -793750000, 4),
            p(8, 60_000, 436600000, -793750000, 4),
        ).forEach(d::push)
        assertEquals(1009L, d.runningTotalM()) // TypeScript: 1009
    }

    @Test
    fun `a 5 s scooter ride, a jittery dwell with poor accuracy and a ride out match the engine`() {
        // The same generator as the TypeScript check (case 2): 2878 m there.
        val fixes = ArrayList<RecordedFix>()
        var seq = 100L
        for (i in 0 until 60) fixes += p(seq++, i * 5000L, 515072000L + ((i * 37) % 11) * 30, -1275000L + i * 6500L, 4L + (i % 5))
        for (i in 60 until 100) {
            fixes += p(seq++, i * 5000L, 515072000L + ((i * 13) % 7) * 90, -1275000L + 59 * 6500 + ((i * 7) % 5) * 100, 12L + (i % 3) * 10)
        }
        fixes += p(seq++, 100 * 5000L, 515080000, -1275000L + 59 * 6500 + 2000, 35)
        for (i in 101 until 130) fixes += p(seq++, i * 5000L, 515080000L + (i - 101) * 450, -1275000L + 59 * 6500 + 2000, 6)
        fixes += fixes[10]
        val d = LiveDistance(start)
        fixes.forEach(d::push)
        assertEquals(2878L, d.runningTotalM())
    }

    @Test
    fun `haversine matches the engine to the decimetre`() {
        assertEquals(10034L, Geo.haversineDm(436532000, -793832000, 436600000, -793750000))
        assertEquals(0L, Geo.haversineDm(0, 0, 0, 1))
        assertEquals(2159L, Geo.haversineDm(-337000000, 1512000000, -337010000, 1512020000))
        assertEquals(200150868L, Geo.haversineDm(899999999, 0, -899999999, 1800000000))
    }

    @Test
    fun `nothing counted is zero`() {
        assertEquals(0L, LiveDistance(start).runningTotalM())
    }

    // `northM` metres north of 43.65, -79.38 (1 m of latitude is about 89.93 e7 units).
    private fun north(seq: Long, tS: Long, northM: Double, acc: Long) =
        p(seq, tS * 1000, 436_500_000L + Math.round(northM * 89.932), -793_800_000L, acc)

    @Test
    fun `the minimum move follows the worse accuracy of anchor and fix (ADR 0006)`() {
        assertEquals(200L, LiveDistance.minMoveDm(5, 5))
        assertEquals(200L, LiveDistance.minMoveDm(20, 3))
        assertEquals(210L, LiveDistance.minMoveDm(21, 3))
        assertEquals(350L, LiveDistance.minMoveDm(3, 35))
        assertEquals(500L, LiveDistance.minMoveDm(50, 50))
        val d = LiveDistance(start)
        d.push(north(1, 0, 0.0, 35))
        d.push(north(2, 10, 30.0, 5))
        assertEquals(0L, d.runningTotalM(), "30 m from a 35 m anchor is jitter")
        d.push(north(3, 20, 36.0, 5))
        assertEquals(36L, d.runningTotalM())
    }

    @Test
    fun `a parked phone with poor accuracy wandering 20 to 45 m adds nothing`() {
        val d = LiveDistance(start)
        for (i in 0..10) d.push(north(i + 1L, i * 10L, i * 100.0, 5))
        for (i in 1..30) {
            val w = 20 + (i * 11) % 26
            d.push(north(20L + i, 100L + i * 10, 1000.0 + if (i % 2 == 0) w else -w, minOf(50L, w + 1L)))
        }
        assertEquals(1000L, d.runningTotalM())
        d.push(north(99, 500, 1100.0, 5))
        assertEquals(1100L, d.runningTotalM())
    }

    @Test
    fun `rounds decimetres to metres half up`() {
        assertEquals(1L, Math2.divRound(5, 10))
        assertEquals(0L, Math2.divRound(4, 10))
        assertEquals(0L, Math2.divRound(-5, 10)) // floor((2*-5+10)/20) = 0, as divRound in ints.ts
    }
}

/** Ported from the Expo tracker's CadenceConfigTest with the new defaults. */
class CadenceConfigTest {
    @Test
    fun nullAndEmptyGiveTheNativeDefaults() {
        val d = CadenceConfig(5_000L, 0f, 15_000L, 150_000L, 60_000L)
        assertEquals(d, CadenceConfig.fromMap(null))
        assertEquals(d, CadenceConfig.fromMap(emptyMap()))
    }

    @Test
    fun partialConfigOverridesOnlyGivenKeys() {
        val c = CadenceConfig.fromMap(mapOf("intervalMs" to 10_000.0, "minDisplacementM" to 10, "extra" to "x"))
        assertEquals(10_000L, c.intervalMs)
        assertEquals(10f, c.minDisplacementM)
        assertEquals(15_000L, c.maxUpdateDelayMs)
        assertEquals(150_000L, c.stillTimeoutMs)
    }

    @Test
    fun explicitNullKeepsDefault() {
        assertEquals(5_000L, CadenceConfig.fromMap(mapOf("intervalMs" to null)).intervalMs)
    }

    @Test
    fun rejectsNonNumbersAndNonFinite() {
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("intervalMs" to "10")) }
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("stillTimeoutMs" to Double.NaN)) }
    }

    @Test
    fun rejectsOutOfRangeValues() {
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("intervalMs" to 500)) }
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("minDisplacementM" to -1)) }
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("stillTimeoutMs" to 1_000)) }
        kotlin.test.assertFailsWith<IllegalArgumentException> { CadenceConfig.fromMap(mapOf("lowPowerIntervalMs" to 1_000)) }
        // maxUpdateDelay may not be below the interval
        kotlin.test.assertFailsWith<IllegalArgumentException> {
            CadenceConfig.fromMap(mapOf("intervalMs" to 60_000, "maxUpdateDelayMs" to 30_000))
        }
    }

    @Test
    fun roundTripsThroughTheFlatMap() {
        val c = CadenceConfig(10_000L, 10f, 15_000L, 90_000L, 120_000L)
        assertEquals(c, CadenceConfig.fromMap(c.toMap()))
    }

    @Test
    fun trackingSettingsRoundTripAndNeverThrowOnBadStoredValues() {
        val s = TrackingSettings(CadenceConfig(intervalMs = 7_000L, maxUpdateDelayMs = 7_000L), detectionEnabled = true, nudgeAfterMs = 0)
        assertEquals(s, TrackingSettings.fromMap(s.toMap()))
        assertEquals(TrackingSettings(), TrackingSettings.fromMap(null))
        val bad = TrackingSettings.fromMap(mapOf("intervalMs" to 1, "nudgeAfterMs" to 5L, "detectionEnabled" to "yes"))
        assertEquals(TrackingSettings(), bad)
        kotlin.test.assertFailsWith<IllegalArgumentException> { TrackingSettings(nudgeAfterMs = 60_000) }
    }
}
