package expo.modules.commatracker

import org.junit.Assert.assertEquals
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
}

class ShiftNoticeTest {
    @Test
    fun `first shift of the day`() {
        val t = ShiftNotice(startedAt = 0, footer = "Started 09:02 · Prius").text(12_345)
        assertEquals("12.3 km this shift", t.title)
        assertEquals("Today 12.3 km · first shift", t.text)
        assertEquals("Today 12.3 km · first shift\nStarted 09:02 · Prius\nTap to open MileWage", t.expanded)
        assertEquals("12.3 km", t.chip)
    }

    @Test
    fun `adds the shifts already ended today, in miles`() {
        val t = ShiftNotice(startedAt = 0, unit = "mi", earlierM = 16_093, earlierShifts = 2).text(1_609)
        assertEquals("1.0 mi this shift", t.title)
        assertEquals("Today 11.0 mi over 3 shifts", t.text)
        assertEquals("Today 11.0 mi over 3 shifts\nTap to open MileWage", t.expanded)
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
