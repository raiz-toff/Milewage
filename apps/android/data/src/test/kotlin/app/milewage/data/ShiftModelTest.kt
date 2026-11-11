package app.milewage.data

import app.milewage.core.api.ApiJson
import app.milewage.core.api.ChangeType
import app.milewage.core.api.Settings
import app.milewage.core.api.TripKind
import app.milewage.core.shift.BatteryReading
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.Recovery
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.StartResult
import app.milewage.core.shift.TripSource
import app.milewage.core.tracking.CommandOutcome
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionReason
import app.milewage.core.tracking.RecordedFix
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.ID
import app.milewage.data.support.Phone.Companion.drive
import app.milewage.engine.ALGORITHM_VERSION
import app.milewage.engine.FlagCode
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.After
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The shift model on the phone's database (ports of the Expo app's localshift, edits, odometer,
 * summary and shiftsummary tests): start, end with the engine, recovery after a kill, the
 * unfinished shift, the notification buttons and the driver's edits.
 */
class ShiftModelTest {
    private val servers = ArrayList<FakeMileWage>()

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    private val fixtures = Json.parseToJsonElement(File("../../../packages/track-engine/conformance/fixtures.json").readText()).jsonObject

    /** Plays a conformance fixture through the phone, offline: start, its fixes, end. */
    private suspend fun ride(name: String, p: Phone): JsonObject {
        val input = fixtures["inputs"]!!.jsonObject[name]!!.jsonObject
        p.net.down = true
        p.clock.t = input["startedAt"]!!.jsonPrimitive.long
        p.data.startShift(3)
        val fixes = input["fixes"]!!.jsonArray.map { it.jsonObject }.map { f ->
            RecordedFix(0, "", f["recordedAt"]!!.jsonPrimitive.long, f["latE7"]!!.jsonPrimitive.long, f["lonE7"]!!.jsonPrimitive.long, f["accuracyM"]!!.jsonPrimitive.long, null, null, null, "gps", null, null)
        }
        p.record(fixes)
        p.clock.t = input["endedAt"]!!.jsonPrimitive.long
        return input
    }

    private fun expected(name: String) = Json.parseToJsonElement(fixtures["expected"]!!.jsonObject[name]!!.jsonPrimitive.content).jsonObject

    @Test
    fun offlineTheShiftStoresTheTotalsTripsStopsAndRouteTheSharedEngineGivesForAKnownRide() = runBlocking {
        val p = Phone(server())
        val input = ride("scenario_delivery_run", p)
        assertIs<EndResult.Ended>(p.data.endShift(odometerEndM = 90_000))
        assertFalse(p.data.sendNow())
        val want = expected("scenario_delivery_run")
        val totals = want["totals"]!!.jsonObject
        val row = p.data.store.shift(ID)!!
        assertEquals(ShiftStatus.ENDED, row.status)
        assertEquals(CalcSource.PHONE, row.calcSource)
        assertEquals(SendState.ON_PHONE_ONLY, row.sendState)
        assertEquals(totals["totalM"]!!.jsonPrimitive.long, row.distances!!.totalM)
        assertEquals(6_300, row.distances!!.totalM)
        assertEquals(totals["activeM"]!!.jsonPrimitive.long, row.distances!!.activeM)
        assertEquals(totals["deadheadM"]!!.jsonPrimitive.long, row.distances!!.deadheadM)
        assertEquals(ALGORITHM_VERSION, row.calcVersion)
        assertEquals(input["fixes"]!!.jsonArray.size.toLong(), row.manifest!!.pointCount)
        val trips = p.data.store.trips(ID)
        assertEquals(
            want["trips"]!!.jsonArray.map { it.jsonObject["kind"]!!.jsonPrimitive.content to it.jsonObject["distanceM"]!!.jsonPrimitive.long },
            trips.map { it.kind.name.lowercase() to it.distanceM },
        )
        assertTrue(trips.all { it.source == TripSource.AUTO })
        assertEquals(want["stops"]!!.jsonArray.size, p.data.store.stops(ID).size)
        assertTrue(p.data.store.route(ID).size >= 2)
        assertEquals(90_000, p.data.store.odometer(ID).single { it.kind == OdometerKind.SHIFT_END }.readingM)
    }

    @Test
    fun withStopDetectionOffNoStopsAreStored() = runBlocking {
        val off = ApiJson.decodeFromJsonElement(Settings.serializer(), JsonObject(FakeMileWage.SETTINGS + ("stops_enabled" to kotlinx.serialization.json.JsonPrimitive(false))))
        val p = Phone(server(), settings = off)
        ride("scenario_delivery_run", p)
        p.data.endShift()
        assertEquals(app.milewage.core.api.Segmenter.WHOLE_SHIFT, p.data.store.shift(ID)!!.segmenter)
        assertEquals(emptyList(), p.data.store.stops(ID))
        assertTrue(p.data.store.trips(ID).isNotEmpty())
    }

    @Test
    fun aShiftWithoutFixesEndsAndSendsOnlyItsEndTime() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.data.startShift(3)
        p.clock.t = 50_000
        val end = p.data.endShift() as EndResult.Ended
        assertNull(end.run)
        assertNull(p.data.store.shift(ID)!!.distances)
        assertTrue(p.data.sendNow())
        assertEquals(buildJsonObject { put("ended_at", 50_000) }, srv.calls.last { it.path.endsWith("/end") }.body)
    }

    @Test
    fun aKillBetweenEndShiftAndTheHandOffIsFinishedAtTheNextStartWithOneEnd() = runBlocking {
        val srv = server()
        val first = Phone(srv)
        first.net.down = true
        first.data.startShift(3)
        first.record(drive(2_000, 5))
        // "End shift" got as far as storing its time, then the process died.
        first.data.store.upsertShift(first.data.store.shift(ID)!!.copy(endedAt = 60_000))
        first.db.close()

        val again = Phone(srv, dbFile = first.dbFile)
        assertEquals(Recovery.FINISHED_END, again.data.shifts.recover())
        assertNull(again.data.shifts.running())
        assertEquals(ShiftStatus.ENDED, again.data.store.shift(ID)!!.status)
        assertEquals(Recovery.NONE, again.data.shifts.recover())
        assertTrue(again.data.sendNow())
        assertEquals(listOf("POST /shifts/$ID/end"), srv.writes().filter { it.endsWith("/end") })
        assertEquals(60_000L, (srv.calls.last { it.path.endsWith("/end") }.body as JsonObject)["ended_at"]!!.jsonPrimitive.long)
    }

    @Test
    fun anUnfinishedShiftSilentFor12HoursIsEndedAtItsLastFixNeverNow() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 10)) // last fix at 92 s
        p.recorder.recordingId = null // the phone was off; the tracker is not recording
        p.clock.t = 92_000 + 13 * 3_600_000L
        assertEquals(Recovery.AUTO_CLOSED, p.data.shifts.recover())
        val s = p.data.store.shift(ID)!!
        assertEquals(92_000L, s.endedAt)
        assertTrue(s.autoClosed)
        assertTrue(s.phoneFlags.any { it.code == FlagCode.SHIFT_AUTO_CLOSED })
        assertTrue(p.data.sendNow())
        assertEquals(92_000L, (srv.calls.last { it.path.endsWith("/end") }.body as JsonObject)["ended_at"]!!.jsonPrimitive.long)
    }

    @Test
    fun aRunningShiftTheTrackerLostRecentlyIsRecordedAgain() = runBlocking {
        val p = Phone(server())
        p.data.startShift(3)
        p.record(drive(2_000, 3))
        p.recorder.recordingId = null
        p.clock.t = 3_600_000
        assertEquals(Recovery.RESUMED, p.data.shifts.recover())
        assertEquals(ID, p.recorder.recordingId)
        assertEquals(Recovery.RECORDING, p.data.shifts.recover())
        p.recorder.recordingId = null
        p.recorder.refuse = true
        assertEquals(Recovery.NOT_RECORDING, p.data.shifts.recover())
        assertIs<EndResult.Ended>(p.data.closeUnfinished())
        assertEquals(22_000L, p.data.store.shift(ID)!!.endedAt) // its last fix
    }

    @Test
    fun aStartTheTrackerRefusesWritesNothingAndOneShiftRunsAtATime() = runBlocking {
        val p = Phone(server())
        p.recorder.refuse = true
        assertEquals(StartResult.RecorderRefused, p.data.startShift(3))
        assertEquals(emptyList(), p.data.store.shifts())
        assertEquals(0, p.data.sender.outbox.counts().pending)
        p.recorder.refuse = false
        assertIs<StartResult.Started>(p.data.startShift(3))
        assertIs<StartResult.AlreadyRunning>(p.data.startShift(3))
        val unpaired = Phone(server(), paired = false)
        assertEquals(StartResult.NotPaired, unpaired.data.startShift(3))
    }

    @Test
    fun theEndShiftButtonEndsTheShift() = runBlocking {
        val p = Phone(server())
        assertEquals(1, p.data.refreshVehicles().vehicles.size)
        assertIs<StartResult.Started>(p.data.startShift(3))
        assertEquals(CommandOutcome.DONE, p.data.shiftCommands.endShift())
        assertNull(p.data.shifts.running())
        // Offline, the kept vehicle list stays.
        p.net.down = true
        val offline = p.data.refreshVehicles()
        assertTrue(offline.offline)
        assertEquals(1, offline.vehicles.size)
    }

    @Test
    fun theTrackersInterruptionsGoWithTheEndAndStayWithTheShift() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 20))
        p.recorder.interruptionsById[ID] = listOf(Interruption(50_000, 80_000, InterruptionReason.SERVICE_RESTARTED))
        p.clock.t = 300_000
        val end = p.data.endShift() as EndResult.Ended
        assertTrue(end.run!!.result.flags.any { it.code == FlagCode.TRACKING_INTERRUPTED })
        assertEquals(listOf(Interruption(50_000, 80_000, InterruptionReason.SERVICE_RESTARTED)), p.data.store.interruptions(ID))
        p.data.sendNow()
        val body = srv.calls.last { it.path.endsWith("/end") }.body as JsonObject
        assertEquals(50_000L, body["interruptions"]!!.jsonArray[0].jsonObject["from_ms"]!!.jsonPrimitive.long)
    }

    @Test
    fun reclassifyingATripShowsAtOnceMovesTheSplitAndIsSentAsOneOverride() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        ride("scenario_delivery_run", p)
        p.data.endShift()
        p.net.down = false
        p.data.sendNow()
        val trip = p.data.store.trips(ID).first { it.kind == TripKind.DEADHEAD }
        val before = p.data.store.shift(ID)!!.distances!!
        p.recorder.offset = 1_500
        assertEquals(EditResult.Ok, p.data.editTrip(trip.tripKey, kind = TripKind.PERSONAL, purpose = "  Groceries "))
        val after = p.data.store.shift(ID)!!.distances!!
        assertEquals(before.totalM, after.totalM) // the distance is never touched
        assertEquals(before.deadheadM - trip.distanceM, after.deadheadM)
        assertEquals(before.personalM + trip.distanceM, after.personalM)
        val edited = p.data.store.trip(trip.tripKey)!!
        assertEquals("Groceries", edited.purpose)
        assertEquals(p.clock.t + 1_500, edited.editedAt) // GNSS-corrected edit time
        assertEquals(trip.distanceM, edited.distanceM)
        p.data.sendNow()
        val put = srv.calls.single { it.method == "PUT" && it.path.contains("/trip-overrides/") }
        assertEquals("personal", (put.body as JsonObject)["kind"]!!.jsonPrimitive.content)
        assertEquals("Groceries", put.body["purpose"]!!.jsonPrimitive.content)
    }

    @Test
    fun editsThatCannotBeMadeAreRefusedBeforeTheyAreQueued() = runBlocking {
        val p = Phone(server())
        ride("scenario_delivery_run", p)
        p.data.endShift()
        val trip = p.data.store.trips(ID).first()
        assertEquals(EditResult.Refused(EditResult.Reason.NO_TRIP), p.data.editTrip("nope", TripKind.PERSONAL))
        assertEquals(EditResult.Refused(EditResult.Reason.INVALID), p.data.editTrip(trip.tripKey, purpose = "   "))
        assertEquals(EditResult.Refused(EditResult.Reason.INVALID), p.data.addManualTrip(ID, TripKind.ACTIVE, 2_000, 1_000, 10))
        assertEquals(EditResult.Refused(EditResult.Reason.INVALID), p.data.addManualTrip(ID, TripKind.ACTIVE, 1_000, 2_000, 0))
        assertEquals(EditResult.Refused(EditResult.Reason.INVALID), p.data.setNotes(ID, "x".repeat(1_001)))
        assertEquals(EditResult.Refused(EditResult.Reason.INVALID), p.data.setOdometer(ID, OdometerKind.SHIFT_END, -1))
        assertEquals(EditResult.Refused(EditResult.Reason.NO_SHIFT), p.data.setNotes("nope", "x"))
        p.data.store.upsertShift(p.data.store.shift(ID)!!.copy(status = ShiftStatus.FINALIZED))
        assertEquals(EditResult.Refused(EditResult.Reason.FINALIZED), p.data.editTrip(trip.tripKey, TripKind.PERSONAL))
        assertEquals(0, p.data.sender.outbox.pending().count { it.kind == ChangeType.TRIP_OVERRIDE || it.kind == ChangeType.SHIFT_PATCH })
    }

    @Test
    fun aManualTripIsStoredCountedKeyedByALowerCaseIdAndSentAsAnIdempotentPut() = runBlocking {
        val srv = server()
        val p = Phone(srv, ids = listOf(ID, "ABCDEF00-0000-4000-8000-000000000000"))
        p.data.startShift(3)
        p.clock.t = 100_000
        p.data.endShift()
        p.data.sendNow()
        assertEquals(EditResult.Ok, p.data.addManualTrip(ID, TripKind.ACTIVE, 10_000, 20_000, 2_500))
        val t = p.data.store.trips(ID).single()
        assertEquals("abcdef00-0000-4000-8000-000000000000", t.tripKey)
        assertEquals("Business driving", t.purpose)
        p.data.sendNow()
        assertEquals(1, srv.calls.count { it.method == "PUT" && it.path == "/shifts/$ID/trips/${t.tripKey}" })
    }

    @Test
    fun theOdometerIsAskedOnceThenNotUntilDue() = runBlocking {
        val p = Phone(server())
        p.clock.t = 1_762_000_000_000L
        assertTrue(p.data.odometerDue(3))
        p.data.markOdometerChecked(3)
        assertFalse(p.data.odometerDue(3))
        p.clock.t += 15 * 86_400_000L
        assertTrue(p.data.odometerDue(3))
        p.data.startShift(3, odometerStartM = 1_000_000) // a reading counts as a check
        assertFalse(p.data.odometerDue(3))
    }

    @Test
    fun theRunningShiftShowsItsLiveDistanceAndTheHomeSummaryCountsUnsentShifts() = runBlocking {
        val own = ApiJson.decodeFromJsonElement(
            Settings.serializer(),
            JsonObject(
                FakeMileWage.SETTINGS + mapOf(
                    "mileage_rate" to kotlinx.serialization.json.JsonPrimitive("yours"),
                    "own_mileage_rate" to buildJsonObject { put("cents_per_unit", 50.0); put("unit", "km") },
                ),
            ),
        )
        val p = Phone(server(), settings = own)
        p.net.down = true
        p.clock.t = 1_762_000_000_000L
        p.data.startShift(3)
        p.record(drive(p.clock.t + 1_000, 11)) // ten steps of about 111 m
        val live = p.data.runningNow()!!
        assertTrue(live.distanceM in 1_050..1_150, "${live.distanceM}")
        assertEquals(Math.round(live.distanceM * 50 / 1_000.0), live.deductionSoFarCents!!, "${live.deductionSoFarCents}")
        p.clock.t += 200_000
        p.data.endShift()
        val sum = p.data.summaryNow()
        assertEquals(1, sum.day.shifts)
        assertEquals(1, sum.day.unsent)
        assertEquals(p.data.store.shift(ID)!!.distances!!.totalM, sum.week.totalM)
        assertNotNull(sum.month.deductionCents)
        assertNull(p.data.runningNow())
    }

    @Test
    fun theShiftSummaryIsRecordedOnceAtTheEndWithBatteryAndCountsNeverCoordinates() = runBlocking {
        val p = Phone(server())
        p.battery = BatteryReading(80, false)
        p.data.startShift(3)
        p.record(drive(2_000, 20))
        p.battery = BatteryReading(61, true)
        p.clock.t = 3_602_000
        p.data.endShift()
        val events = p.data.store.oldestDiag(100).map { it.second }
        val summary = events.single { it.kind == "shift.summary" }
        assertEquals(ID, summary.shift)
        assertEquals(80, summary.data["battery_start"]!!.jsonPrimitive.int)
        assertEquals(61, summary.data["battery_end"]!!.jsonPrimitive.int)
        assertEquals(true, summary.data["charging_seen"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(20, summary.data["fixes"]!!.jsonPrimitive.int)
        assertEquals(3_601, summary.data["duration_s"]!!.jsonPrimitive.int)
        assertTrue(events.any { it.kind == "engine.run" })
        assertFalse(events.joinToString { it.data.toString() }.contains("400000000"))
    }
}
