package app.milewage.core.shift

import app.milewage.core.api.DistanceUnit
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionReason
import app.milewage.core.tracking.RecordedFix
import app.milewage.engine.FlagCode
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The pure parts of the shift model: summary, odometer cadence, the engine input (ports of summary, odometer and localshift tests). */
class ShiftLogicTest {
    private val day = 86_400_000L

    private fun row(date: String, total: Long?, personal: Long = 0, send: SendState = SendState.SENT, status: ShiftStatus = ShiftStatus.ENDED, id: String = "$date:$total:$send", vehicle: Long = 1) =
        ShiftRecord(
            clientId = id, vehicleId = vehicle, status = status, segmenter = Segmenter.STOPS, startedAt = 0, endedAt = 1,
            localDate = date, distances = total?.let { Distances(it, it - personal, 0, personal) }, updatedAt = 1, sendState = send,
        )

    /** One cent per metre up to 5,000 m in a calendar year, half a cent after (a tiered pack, like Canada's). */
    private val tiered = object : MileageRates {
        override fun periodOf(date: String) = date.take(4)

        override fun deduction(businessM: Long, priorM: Long, date: String, vehicleKind: String): Long? {
            if (vehicleKind == "bicycle") return null
            val first = maxOf(0, minOf(businessM, 5_000 - priorM))
            return first + (businessM - first) / 2
        }
    }

    @Test
    fun weeksStartOnMondayOrOnSundayWhenSet() {
        assertEquals("2025-10-13", Summaries.weekStart("2025-10-15"))
        assertEquals("2025-10-13", Summaries.weekStart("2025-10-13"))
        assertEquals("2025-10-13", Summaries.weekStart("2025-10-19"))
        assertEquals("2025-10-12", Summaries.weekStart("2025-10-15", weekStart = 0))
    }

    @Test
    fun sumsDayWeekAndMonthFromTheShiftsOnThePhoneAndCountsUnsentOnes() {
        val s = Summaries.summarize(
            listOf(
                row("2025-10-02", 1_000), // this month, not this week
                row("2025-10-14", 1_600, send = SendState.ON_PHONE_ONLY),
                row("2025-10-15", 800),
                row("2025-10-15", 9_900, status = ShiftStatus.RUNNING), // running: not counted
                row("2025-10-16", null), // no totals yet: not counted
                row("2025-09-30", 500), // last month
            ),
            today = "2025-10-15",
            rates = tiered,
            vehicleKinds = emptyMap(),
        )
        assertEquals(PeriodSummary("2025-10-15", "2025-10-15", 1, 0, 800, 800, 800), s.day)
        assertEquals("2025-10-13", s.week.from)
        assertEquals(2, s.week.shifts)
        assertEquals(1, s.week.unsent)
        assertEquals(2_400, s.week.totalM)
        assertEquals(3, s.month.shifts)
        assertEquals(3_400, s.month.totalM)
        assertEquals(3_400, s.month.deductionCents)
    }

    @Test
    fun aPersonalTripLeavesTheEstimateButNotTheTotal() {
        val mixed = Summaries.summarize(listOf(row("2025-10-15", 1_600, personal = 600, send = SendState.ON_PHONE_ONLY)), "2025-10-15", tiered, emptyMap())
        assertEquals(1_600, mixed.month.totalM)
        assertEquals(1_000, mixed.month.businessM)
        assertEquals(1_000, mixed.month.deductionCents)
    }

    @Test
    fun aTierIsSharedAcrossShiftsOfThePeriodAndNoRateMeansNullNotZero() {
        val s = Summaries.summarize(listOf(row("2025-03-01", 4_000), row("2025-10-15", 2_000)), "2025-10-15", tiered, emptyMap())
        assertEquals(1_000 + 500, s.month.deductionCents) // 1,000 m left in the first tier, then half
        assertNull(Summaries.summarize(listOf(row("2025-10-15", 2_000)), "2025-10-15", MileageRates.None, emptyMap()).month.deductionCents)
        assertNull(Summaries.summarize(listOf(row("2025-10-15", 2_000, vehicle = 9)), "2025-10-15", tiered, mapOf(9L to "bicycle")).month.deductionCents)
    }

    @Test
    fun theServersValueWinsForAShiftItSentIncludingNone() {
        val sent = row("2025-10-15", 2_000).copy(serverDeductionKnown = true, serverDeductionCents = 77)
        assertEquals(77, Summaries.summarize(listOf(sent), "2025-10-15", tiered, emptyMap()).month.deductionCents)
        val none = row("2025-10-15", 2_000).copy(serverDeductionKnown = true, serverDeductionCents = null)
        assertNull(Summaries.summarize(listOf(none), "2025-10-15", tiered, emptyMap()).month.deductionCents)
    }

    @Test
    fun theDriversOwnRateIsNeverForANonAutomobile() {
        val own = MileageRates.OwnRate(centsPerUnit = 70.0, unit = DistanceUnit.KM)
        assertEquals(700, own.deduction(10_000, 0, "2025-10-15", "car"))
        assertNull(own.deduction(10_000, 0, "2025-10-15", "bicycle"))
        assertEquals(435, MileageRates.OwnRate(70.0, DistanceUnit.MI).deduction(10_000, 0, "2025-10-15", "car"))
    }

    @Test
    fun anOwnRateInTwoStepsCountsTheServersDistanceThenTheUnsentShifts() {
        val step = MileageRates.Step(thresholdUnits = 5_000, centsPerUnitAfter = 64.0, periodStart = "2026-01-01", serverM = mapOf("car" to 4_990_000L))
        val own = MileageRates.OwnRate(70.0, DistanceUnit.KM, step)
        assertEquals(700, own.deduction(10_000, 0, "2026-11-10", "car")) // the last 10 km below 5,000
        assertEquals(670, own.deduction(10_000, 5_000, "2026-11-10", "car")) // 5 km at 70, 5 km at 64
        assertEquals(640, own.deduction(10_000, 10_000, "2026-11-10", "car"))
        assertEquals(700, own.deduction(10_000, 0, "2026-11-10", "van")) // the server counted no van
        assertEquals(700, own.deduction(10_000, 0, "2027-01-02", "car")) // a new year starts again
        assertNull(own.deduction(10_000, 0, "2026-11-10", "bicycle"))
        // Two unsent shifts: the second is priced after the first; a shift the server valued adds nothing.
        val valued = row("2026-11-08", 9_000).copy(serverDeductionKnown = true, serverDeductionCents = 630)
        val unsent = listOf(row("2026-11-09", 5_000, send = SendState.ON_PHONE_ONLY), row("2026-11-10", 10_000, send = SendState.ON_PHONE_ONLY))
        val s = Summaries.summarize(listOf(valued) + unsent, "2026-11-10", own, emptyMap())
        assertEquals(630 + 350 + 670, s.month.deductionCents)
    }

    @Test
    fun theRunningShiftIsPricedAfterTheShiftsBeforeIt() {
        val before = listOf(row("2025-10-01", 4_500))
        val running = row("2025-10-15", null, status = ShiftStatus.RUNNING, id = "run")
        assertEquals(500 + 250, Summaries.runningValue(before, running, 1_000, tiered, emptyMap()))
        assertNull(Summaries.runningValue(before, running, 1_000, MileageRates.None, emptyMap()))
    }

    @Test
    fun theOdometerIsAskedTheFirstTimeMonthlyAndAfter14Days() {
        val first = 1_762_000_000_000L // 2025-11-01 12:26 UTC
        assertTrue(OdometerDue.due(first, "UTC", null))
        assertFalse(OdometerDue.due(first + 5 * day, "UTC", first))
        assertTrue(OdometerDue.due(first + 14 * day, "UTC", first))
        // A new month in the driver's zone, even a day later.
        val lastOfOct = 1_761_908_400_000L // 2025-10-31 11:00 UTC
        assertTrue(OdometerDue.due(lastOfOct + day, "UTC", lastOfOct))
        assertFalse(OdometerDue.due(lastOfOct + 3_600_000, "UTC", lastOfOct))
    }

    private fun fix(seq: Long, t: Long, acc: Long = 5, provider: String = "gps", phone: Long? = t + 2_000) =
        RecordedFix(seq, "s", t, 400_000_000 + seq * 1_000, 0, acc, null, null, null, provider, null, phone)

    @Test
    fun theEngineInputCarriesInterruptionsEditsAndTheClockSkewOfGnssFixesOnly() {
        val shift = row("2025-10-15", null, status = ShiftStatus.RUNNING, id = "s").copy(startedAt = 1_000)
        val fixes = listOf(fix(1, 1_000), fix(2, 6_000), fix(3, 11_000, provider = "network", phone = 11_000 + 99_000))
        val trips = listOf(
            TripRecord("s:1000:active", "s", kind = TripKind.PERSONAL, originalKind = TripKind.ACTIVE, source = TripSource.AUTO, startedAt = 1, endedAt = 2, distanceM = 5, purpose = "errand", editedAt = 9),
            TripRecord("m", "s", kind = TripKind.ACTIVE, originalKind = TripKind.ACTIVE, source = TripSource.MANUAL, startedAt = 1, endedAt = 2, distanceM = 5, purpose = "x", editedAt = 9),
            TripRecord("s:2000:active", "s", kind = TripKind.ACTIVE, originalKind = TripKind.ACTIVE, source = TripSource.AUTO, startedAt = 1, endedAt = 2, distanceM = 5, purpose = ""),
        )
        val input = ShiftRun.input(shift, 20_000, fixes, listOf(Interruption(2_000, 3_000, InterruptionReason.LOCATION_OFF)), trips, autoClosed = true)
        assertEquals(2_000, input.clockSkewMs) // the network fix's phone clock does not count
        assertEquals(listOf("s:1000:active"), input.edits.map { it.tripKey })
        assertEquals(listOf(app.milewage.engine.Interruption(2_000, 3_000)), input.interruptions)
        val run = ShiftRun.run(input, Segmenter.STOPS)!!
        assertTrue(run.result.flags.any { it.code == FlagCode.SHIFT_AUTO_CLOSED })
        assertTrue(run.result.flags.any { it.code == FlagCode.TRACKING_INTERRUPTED })
        assertEquals(app.milewage.core.api.PointManifest(1, 3, 3), run.manifest)
        assertEquals(run.result.inputDigest, run.phoneResult.inputDigest)
        assertNull(ShiftRun.run(input.copy(fixes = emptyList()), Segmenter.STOPS))
    }

    @Test
    fun anUnfinishedShiftEndsAtItsLastQualifiedFixNeverNow() {
        val fixes = listOf(fix(1, 1_000), fix(2, 50_000), fix(3, 90_000, acc = 80))
        assertEquals(50_000, ShiftRun.autoCloseEnd(500, fixes)) // the 80 m fix is not qualified
        assertEquals(500, ShiftRun.autoCloseEnd(500, emptyList()))
    }

    @Test
    fun liveTotalsReadOnlyTheNewFixesEachTime() = runBlocking {
        val stored = ArrayList<RecordedFix>()
        var reads = 0
        val live = LiveTotals { _, after, limit ->
            reads++
            stored.filter { it.seq > after }.take(limit)
        }
        val shift = row("2025-10-15", null, status = ShiftStatus.RUNNING, id = "s").copy(startedAt = 0)
        for (i in 1L..5) stored += fix(i, i * 10_000).copy(latE7 = 400_000_000 + i * 10_000)
        val first = live.distanceM(shift)
        assertTrue(first in 400..500, "$first")
        for (i in 6L..10) stored += fix(i, i * 10_000).copy(latE7 = 400_000_000 + i * 10_000)
        assertTrue(live.distanceM(shift) in 900..1_100)
        assertEquals(2, reads)
    }

    @Test
    fun aPurposeIsTrimmedAndOneTo200Characters() {
        assertEquals("Lunch run", ShiftModel.purposeOf("  Lunch run "))
        assertNull(ShiftModel.purposeOf("   "))
        assertNull(ShiftModel.purposeOf("x".repeat(201)))
        assertEquals("Business driving", ShiftModel.purposeOf(ShiftModel.MANUAL_TRIP_PURPOSE))
    }
}
