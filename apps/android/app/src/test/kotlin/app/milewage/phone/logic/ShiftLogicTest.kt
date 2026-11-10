package app.milewage.phone.logic

import app.milewage.core.api.TripKind
import app.milewage.core.connect.Where
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ServerFlag
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.tracking.TrackingStatus
import app.milewage.data.ShiftListItem
import app.milewage.engine.Flag
import app.milewage.engine.FlagCode
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.NOW
import app.milewage.phone.support.ROUTE
import app.milewage.phone.support.shift
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShiftGroupsTest {
    private fun item(id: String, date: String, start: Long, m: Long?) =
        ShiftListItem(shift(id, startedAt = start, endedAt = start + 3_600_000, totalM = m, localDate = date), ShiftMarker.ON_PHONE_ONLY, CIVIC)

    @Test
    fun `weeks start on the driver's week start, newest first, with their distance`() {
        val today = LocalDate.parse("2026-11-10") // a Tuesday
        val items = listOf(
            item("a", "2026-11-10", NOW, 10_000),
            item("b", "2026-11-09", NOW - 86_400_000, 5_000),
            item("c", "2026-11-08", NOW - 2 * 86_400_000, 7_000), // Sunday: last week from Monday
            item("d", "2026-10-20", NOW - 21 * 86_400_000, null),
        )
        val monday = ShiftGroups.of(items, today, weekStart = 1)
        assertEquals(listOf(WeekTitle.ThisWeek, WeekTitle.LastWeek, WeekTitle.WeekOf(LocalDate.parse("2026-10-19"))), monday.map { it.title })
        assertEquals(listOf("a", "b"), monday[0].rows.map { it.clientId })
        assertEquals(15_000L, monday[0].totalM)
        assertEquals(2, monday[0].shifts)
        assertNull(monday[2].totalM) // no totals yet: a dash, never 0
        // From Sunday, Sunday the 8th is this week.
        val sunday = ShiftGroups.of(items, today, weekStart = 0)
        assertEquals(listOf("a", "b", "c"), sunday[0].rows.map { it.clientId })
    }

    @Test
    fun `a row keeps the marker the facade gave it (recorded for another server)`() {
        val item = item("a", "2026-11-10", NOW, 10_000).copy(marker = ShiftMarker.OTHER_SERVER)
        val row = ShiftGroups.of(listOf(item), LocalDate.parse("2026-11-10"), weekStart = 1).single().rows.single()
        assertEquals(ShiftMarker.OTHER_SERVER, row.marker)
    }

    @Test
    fun `a row says who calculated it, its send state, and what to check`() {
        val s = shift(sendState = SendState.SENT, calc = CalcSource.SERVER).copy(serverFlags = listOf(ServerFlag("gap_large", "warn"), ServerFlag("no_stops_detected", "info")))
        val row = ShiftGroups.rowOf(s, "Civic")
        assertEquals(ShiftMarker.SENT, row.marker)
        assertEquals(CalcSource.SERVER, row.calcSource)
        assertEquals(1, row.review)
        assertEquals("Civic", row.vehicle)
        assertFalse(row.running)
        assertTrue(ShiftGroups.rowOf(shift(endedAt = null), null).running)
    }
}

class ShiftFlagsTest {
    @Test
    fun `every engine flag has the driver's words`() {
        ShiftFlags.engineCodes.forEach { code -> assertTrue(ShiftFlag.of(code) != ShiftFlag.OTHER, "$code has no meaning") }
        assertEquals(ShiftFlag.OTHER, ShiftFlag.of("something_new"))
    }

    @Test
    fun `the server's flags replace the phone's once it answered, review first, one per kind`() {
        val phone = shift().copy(phoneFlags = listOf(Flag(FlagCode.NO_STOPS_DETECTED), Flag(FlagCode.GAP_DROPPED), Flag(FlagCode.GAP_DROPPED, at = 1)))
        assertEquals(listOf(ShiftFlag.GAP_DROPPED, ShiftFlag.NO_STOPS_DETECTED), ShiftFlags.of(phone))
        val server = phone.copy(calcSource = CalcSource.SERVER, serverFlags = listOf(ServerFlag("clock_skew", "info")))
        assertEquals(listOf(ShiftFlag.CLOCK_SKEW), ShiftFlags.of(server))
        assertEquals(emptyList(), ShiftFlags.review(server))
    }
}

class OverwritesTest {
    private fun entry(reason: OverwriteReason, local: String, server: String?) = OverwriteEntry(5, NOW, "shift", "s1", reason, local, server)

    @Test
    fun `a Difference names both totals, the gap and the reasons`() {
        val o = Overwrites.of(entry(OverwriteReason.RECON_DIFF, """{"total_m":12000}""", """{"total_m":12500,"reasons":["late_points","calc_version","late_points","from_a_newer_server"]}"""))
        // Codes become types (a newer server's unknown one too), each once; the screen has words for each.
        assertEquals(OverwriteText.Difference(5, 12_500, 12_000, listOf(ReconReason.LATE_POINTS, ReconReason.CALC_VERSION, ReconReason.OTHER)), o)
        assertEquals(500, (o as OverwriteText.Difference).diffM)
    }

    @Test
    fun `deleted, an edit not applied, and replaced`() {
        assertEquals(OverwriteText.Deleted(5), Overwrites.of(entry(OverwriteReason.DELETED_ON_SERVER, "{}", null)))
        assertEquals(OverwriteText.EditNotApplied(5), Overwrites.of(entry(OverwriteReason.SUPERSEDED_BY_SERVER, "{}", """{"orphaned":true}""")))
        assertEquals(OverwriteText.Replaced(5), Overwrites.of(entry(OverwriteReason.SUPERSEDED_BY_SERVER, "not json", "{}")))
        // A Difference without numbers is still explained, never a crash.
        assertEquals(OverwriteText.Replaced(5), Overwrites.of(entry(OverwriteReason.RECON_DIFF, "{}", null)))
    }
}

class TripChoiceTest {
    @Test
    fun `stops on offers the business split, off, business or personal`() {
        assertEquals(listOf(TripChoice.ACTIVE, TripChoice.DEADHEAD, TripChoice.PERSONAL), TripChoice.offered(true))
        assertEquals(listOf(TripChoice.BUSINESS, TripChoice.PERSONAL), TripChoice.offered(false))
        assertEquals(TripChoice.BUSINESS, TripChoice.of(TripKind.DEADHEAD, false))
        assertEquals(TripChoice.DEADHEAD, TripChoice.of(TripKind.DEADHEAD, true))
    }

    @Test
    fun `business keeps a business trip's estimated kind and turns personal back into active`() {
        assertEquals(TripKind.DEADHEAD, TripChoice.kindFor(TripChoice.BUSINESS, TripKind.DEADHEAD))
        assertEquals(TripKind.ACTIVE, TripChoice.kindFor(TripChoice.BUSINESS, TripKind.PERSONAL))
        assertEquals(TripKind.PERSONAL, TripChoice.kindFor(TripChoice.PERSONAL, TripKind.ACTIVE))
        assertEquals(TripKind.DEADHEAD, TripChoice.kindFor(TripChoice.DEADHEAD, TripKind.ACTIVE))
    }

    @Test
    fun `edit answers map one to one`() {
        assertEquals(EditOutcome.SAVED, EditOutcome.of(EditResult.Ok))
        EditResult.Reason.entries.forEach { r -> assertTrue(EditOutcome.of(EditResult.Refused(r)) != EditOutcome.SAVED) }
        assertEquals(EditOutcome.FINALIZED, EditOutcome.of(EditResult.Refused(EditResult.Reason.FINALIZED)))
    }
}

class RouteProjectionTest {
    @Test
    fun `the route fits the box with its padding, north up, and keeps its shape`() {
        val pts = ROUTE.map { it.latE7 to it.lonE7 }
        val p = RouteProjection.fit(pts, 400f, 200f, 20f)!!
        val xy = pts.map { p.project(it.first, it.second) }
        xy.forEach { (x, y) ->
            assertTrue(x in 19.99f..380.01f, "x $x")
            assertTrue(y in 19.99f..180.01f, "y $y")
        }
        // The northernmost point is at the top.
        val north = pts.indices.maxBy { pts[it].first }
        assertEquals(xy.minOf { it.second }, xy[north].second)
        // A degree of longitude is shorter than one of latitude at 43.6 N: the shape is not stretched.
        val q = RouteProjection.fit(listOf(0L to 0L, 10_000_000L to 10_000_000L), 1000f, 1000f, 0f)!!
        val (x1, y1) = q.project(10_000_000, 10_000_000)
        val (x0, y0) = q.project(0, 0)
        assertTrue(kotlin.math.abs(x1 - x0) < kotlin.math.abs(y1 - y0))
    }

    @Test
    fun `fewer than two points or a box too small draws nothing`() {
        assertNull(RouteProjection.fit(listOf(1L to 1L), 100f, 100f, 10f))
        assertNull(RouteProjection.fit(listOf(1L to 1L, 2L to 2L), 10f, 100f, 10f))
        // One spot repeated: a dot in the middle, not a division by zero.
        val p = RouteProjection.fit(listOf(5L to 5L, 5L to 5L), 100f, 100f, 10f)!!
        assertEquals(50f to 50f, p.project(5, 5))
    }
}

class DiagnosticsReportTest {
    private val info = DiagnosticsInfo(
        appVersion = "0.3.0",
        versionCode = 3,
        buildType = "debug",
        engineVersion = 4,
        android = "16",
        sdk = 36,
        phone = "Google Pixel 9",
        pairing = PairingStatus.PAIRED,
        route = Where.HOME,
        homeHost = DiagnosticsReport.hostOf("http://192.168.1.20:3200/api?x=1"),
        awayHost = DiagnosticsReport.hostOf("https://milewage.tail1234.ts.net/pair#v=1&t=mwp_secret"),
        tracking = TrackingStatus(),
        permissions = ALLOWED,
        unsentShifts = 2,
        unsentFixes = 340,
        halt = null,
    )

    @Test
    fun `hosts only, no path, no query, no pairing code`() {
        assertEquals("192.168.1.20:3200", info.homeHost)
        assertEquals("milewage.tail1234.ts.net", info.awayHost)
        assertNull(DiagnosticsReport.hostOf("not an address"))
    }

    @Test
    fun `the summary holds versions, states and counts, never a location or a secret`() {
        val text = DiagnosticsReport.text(info, emptyList())
        assertTrue("App: 0.3.0 (build 3, debug)" in text)
        assertTrue("Maths check: passed" in text)
        assertTrue("Not yet on server: 2 shifts, 340 points" in text)
        listOf("mwp_", "mwd_", "lat", "lon", "E7").forEach { assertFalse(it in text, "summary holds $it") }
        assertTrue("Maths check: failed (2)" in DiagnosticsReport.text(info, listOf("sin a", "cos b")))
        assertTrue("Maths check: not run" in DiagnosticsReport.text(info, null))
    }
}

class GatesTest {
    @Test
    fun `the app for a paired phone, first run otherwise, setup after a first connection, and a running shift always stays`() {
        assertEquals(Gate.MAIN, Gates.of(PairingStatus.PAIRED, false, false))
        assertEquals(Gate.FIRST_RUN, Gates.of(PairingStatus.UNPAIRED, false, false))
        assertEquals(Gate.FIRST_RUN, Gates.of(PairingStatus.REVOKED, false, false))
        assertEquals(Gate.MAIN, Gates.of(PairingStatus.REVOKED, true, false))
        // Connected from first run: the setup steps until Ready > Go to home.
        assertEquals(Gate.SETUP, Gates.of(PairingStatus.PAIRED, false, true))
        // Paired again mid-shift: the shift stays on screen; the steps come after it.
        assertEquals(Gate.MAIN, Gates.of(PairingStatus.PAIRED, true, true))
        // A leftover setup flag never shows setup to an unpaired phone.
        assertEquals(Gate.FIRST_RUN, Gates.of(PairingStatus.UNPAIRED, false, true))
    }
}
