package expo.modules.commatracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveDistanceTest {
    private val start = 1_700_000_000_000L

    private fun p(seq: Long, dt: Long, lat: Long, lon: Long, acc: Long) =
        BufferPoint(seq, "s", start + dt, lat, lon, acc, null, null, null)

    @Test
    fun `counts like the shared engine's live accumulator`() {
        // Same fixes as the JS check: one before the window, an inaccurate fix, a speed spike, a
        // step under 20 m and a duplicate seq. createLiveAccumulator gives 1009 m for them.
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
        assertEquals(1009L, d.runningTotalM())
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
        assertEquals("30 m from a 35 m anchor is jitter", 0L, d.runningTotalM())
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
}

class ShiftNoticeTest {
    @Test
    fun `first shift of the day, the distance leads, then start time and vehicle, nothing repeated`() {
        val t = ShiftNotice(startedAt = 7, footer = "Started 09:02 · Prius").text(12_345)
        assertEquals("12.3 km this shift", t.title)
        assertEquals("Started 09:02 · Prius", t.text)
        assertNull("no expanded text that only repeats the collapsed one", t.expanded)
        assertEquals("12.3 km", t.chip)
        // Android 17: the figures side by side, the details in the header.
        assertEquals("Shift in progress", t.metricTitle)
        assertEquals("Started 09:02 · Prius", t.subText)
        assertEquals(
            listOf(
                ShiftNotice.Metric.Distance("Shift", 12.3f, "km"),
                ShiftNotice.Metric.Elapsed("Time", 7),
            ),
            t.metrics,
        )
    }

    @Test
    fun `adds the shifts already ended today, in miles`() {
        val t = ShiftNotice(startedAt = 0, unit = "mi", earlierM = 16_093, earlierShifts = 2, footer = "Started 14:10")
            .text(1_609)
        assertEquals("1.0 mi this shift", t.title)
        assertEquals("Today 11.0 mi · 3 shifts", t.text)
        assertEquals("Today 11.0 mi · 3 shifts\nStarted 14:10", t.expanded)
        assertEquals(ShiftNotice.Metric.Distance("Today", 11.0f, "mi"), t.metrics.last())
        assertEquals(3, t.metrics.size)
    }

    @Test
    fun `labels fit Android's ten characters and nothing changes between fixes in the same tenth`() {
        val n = ShiftNotice(startedAt = 0, earlierShifts = 1, earlierM = 5_000)
        n.text(1_000).metrics.forEach { assertTrue(it.label, it.label.length <= 10) }
        assertEquals("no re-post for 1,020 m after 1,040 m", n.text(1_040), n.text(1_020))
        assertNotEquals(n.text(1_040), n.text(1_060))
        // Without details from the app it still says what it is.
        assertEquals("Shift in progress", ShiftNotice(startedAt = 0).text(0).text)
        assertNull(ShiftNotice(startedAt = 0).text(0).subText)
    }

    @Test
    fun `reads the map from JS with safe defaults`() {
        val n = ShiftNotice.fromMap(
            mapOf("startedAt" to 5.0, "unit" to "furlong", "earlierM" to -3, "earlierShifts" to 1.0),
            fallbackStart = 9,
        )
        assertEquals(ShiftNotice(startedAt = 5, unit = "km", earlierM = 0, earlierShifts = 1), n)
        assertEquals(9L, ShiftNotice.fromMap(emptyMap(), fallbackStart = 9).startedAt)
    }
}
