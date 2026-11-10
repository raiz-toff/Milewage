package app.milewage.core.tracking

import app.milewage.core.format.DistanceUnit
import app.milewage.core.format.TimeFormat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ported from the Expo tracker's ShiftNoticeTest and apps/phone/test/notice.test.ts. */
class ShiftNoticeTest {
    @Test
    fun `first shift of the day, the distance leads, then start time and vehicle, nothing repeated`() {
        val t = ShiftNotice(startedAt = 7, footer = "Started 09:02 · Prius").text(12_345)
        assertEquals("12.3 km this shift", t.title)
        assertEquals("Started 09:02 · Prius", t.text)
        assertNull(t.expanded, "no expanded text that only repeats the collapsed one")
        assertEquals("12.3 km", t.chip)
        assertEquals("Shift in progress", t.metricTitle)
        assertEquals("Started 09:02 · Prius", t.subText)
        assertEquals(
            listOf(ShiftNotice.Metric.Distance("Shift", 12.3f, "km"), ShiftNotice.Metric.Elapsed("Time", 7)),
            t.metrics,
        )
    }

    @Test
    fun `adds the shifts already ended today, in miles`() {
        val t = ShiftNotice(startedAt = 0, unit = DistanceUnit.MI, earlierM = 16_093, earlierShifts = 2, footer = "Started 14:10")
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
        n.text(1_000).metrics.forEach { assertTrue(it.label.length <= 10, it.label) }
        assertEquals(n.text(1_040), n.text(1_020), "no re-post for 1,020 m after 1,040 m")
        assertNotEquals(n.text(1_040), n.text(1_060))
        assertEquals("Shift in progress", ShiftNotice(startedAt = 0).text(0).text)
        assertNull(ShiftNotice(startedAt = 0).text(0).subText)
    }

    @Test
    fun `stored details round trip, and damaged ones take safe defaults`() {
        val n = ShiftNotice(startedAt = 5, unit = DistanceUnit.MI, earlierM = 3, earlierShifts = 1, footer = "Started 14:10 · Bike\nx")
        assertEquals(n, ShiftNotice.decode(n.encode(), fallbackStart = 9))
        assertEquals(ShiftNotice(startedAt = 9), ShiftNotice.decode(null, fallbackStart = 9))
        assertEquals(
            ShiftNotice(startedAt = 9, unit = DistanceUnit.KM, earlierM = 0, earlierShifts = 0),
            ShiftNotice.decode("unit=furlong\nearlierM=-3\nearlierShifts=-1", fallbackStart = 9),
        )
    }

    private val zone = "America/Toronto"
    private val at = 1_794_060_120_000L // 2026-11-07 14:02 UTC, 09:02 in Toronto

    @Test
    fun `counts only today's ended shifts, never the running one`() {
        val n = shiftNotice(
            clientId = "run",
            startedAt = at,
            vehicle = "Civic",
            unit = DistanceUnit.KM,
            timeZone = zone,
            rows = listOf(
                NoticeShiftRow("a", "2026-11-07", "ended", 12_000),
                NoticeShiftRow("b", "2026-11-07", "finalized", 3_500),
                NoticeShiftRow("c", "2026-11-06", "ended", 99_000), // yesterday
                NoticeShiftRow("d", "2026-11-07", "ended", null), // no total yet
                NoticeShiftRow("run", "2026-11-07", "active", null),
            ),
        )
        assertEquals(ShiftNotice(startedAt = at, unit = DistanceUnit.KM, earlierM = 15_500, earlierShifts = 2, footer = "Started 09:02 · Civic"), n)
    }

    @Test
    fun `leaves the vehicle out when its name is not known, and follows the 12h setting`() {
        val n = shiftNotice("run", at, null, emptyList(), DistanceUnit.MI, zone)
        assertEquals("Started 09:02", n.footer)
        assertEquals(0, n.earlierShifts)
        assertEquals("Started 9:02 AM", shiftNotice("run", at, " ", emptyList(), DistanceUnit.MI, zone, TimeFormat.H12).footer)
    }
}
