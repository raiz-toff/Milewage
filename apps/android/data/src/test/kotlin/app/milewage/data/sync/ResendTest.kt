package app.milewage.data.sync

import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.sync.ResendMark
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.drive
import app.milewage.data.support.Phone.Companion.sid
import app.milewage.data.support.TestClock
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Sending again after the server was restored from a backup (a port of the Expo app's resend.test.ts). */
class ResendTest {
    private val servers = ArrayList<FakeMileWage>()
    private val day = 86_400_000L
    private val base = 1_700_000_000_000L

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    private fun phone(srv: FakeMileWage, file: java.io.File? = null, clock: TestClock = TestClock(base)) =
        if (file == null) Phone(srv, clock = clock, ids = (0..9).map(::sid)) else Phone(srv, dbFile = file, clock = clock, ids = (0..9).map(::sid))

    /** Records one shift of [n] fixes on day [d] and ends it, online (it reaches the server). */
    private suspend fun record(p: Phone, d: Int, n: Int, odometer: Long? = null) {
        p.clock.t = base + d * day
        p.data.startShift(3, odometer)
        p.record((0 until n).map { j -> drive(p.clock.t + 1_000 + j * 10_000L, 1, startLat = 400_000_000L + j * 3_000)[0] })
        p.clock.t += n * 10_000L + 5_000
        p.data.endShift()
        p.data.sendNow()
    }

    private suspend fun states(p: Phone) = p.data.store.shifts().associate { it.clientId to it.sendState }

    private fun fixesSent(srv: FakeMileWage, id: String, from: Int = 0) = srv.calls.drop(from)
        .filter { it.path == "/telemetry/batch" && (it.body as JsonObject)["shift_client_id"]!!.jsonPrimitive.content == id }
        .sumOf { (it.body as JsonObject)["points"]!!.jsonArray.size }

    @Test
    fun aRestoreFromBeforeTwoShiftsBothAreSentAgainWithTheirFixesThenSent() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 300, 120_000_000)
        record(p, 1, 700)
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(1) to SendState.SENT), states(p))

        srv.restore(empty) // the server lost both shifts
        assertTrue(p.data.sendNow())
        assertEquals(listOf(sid(0) to "ended", sid(1) to "ended"), srv.state.shifts.values.map { it.clientId to it.status })
        assertEquals(300, srv.state.points[sid(0)]!!.size)
        assertEquals(700, srv.state.points[sid(1)]!!.size)
        assertEquals(120_000_000L, srv.state.odometer["${sid(0)}:shift_start"])
        // `end` again with the manifest and the phone result, after every fix.
        val end = srv.state.shifts[sid(1)]!!.ended!!
        assertEquals(700L, (end["manifest"] as JsonObject)["point_count"]!!.jsonPrimitive.content.toLong())
        assertTrue(end.containsKey("phone_result"))
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(1) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
        assertNull(p.data.sender.status().sync.message)
    }

    @Test
    fun aShiftTheRestoreKeptIsAnsweredAsItIsNothingIsDoubled() = runBlocking {
        val srv = server()
        val p = phone(srv)
        record(p, 0, 400)
        val withFirst = srv.backup()
        record(p, 1, 200)
        val dupBefore = srv.duplicates
        srv.restore(withFirst)
        p.data.sendNow()
        assertEquals(2, srv.state.shifts.size) // the kept shift was not created a second time
        assertEquals(400, srv.state.points[sid(0)]!!.size)
        assertEquals(200, srv.state.points[sid(1)]!!.size)
        assertEquals(400, srv.duplicates - dupBefore) // the kept fixes came back as duplicates
        assertEquals(0, srv.conflicts)
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(1) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }

    @Test
    fun aConnectionLostHalfwayTheNextRoundGoesOnFromTheLastBatchAccepted() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 1_200)
        srv.restore(empty)
        var batches = 0
        srv.overrides["POST /telemetry/batch"] = { if (++batches == 2) srv.problem(503, "unavailable", true) else null }
        assertFalse(p.data.sendNow())
        assertEquals(500, srv.state.points[sid(0)]!!.size)
        assertEquals(listOf(ResendMark(sid(0), 2, ResendMark.Phase.TODO, 500)), p.data.store.resendMarks())
        assertEquals(mapOf(sid(0) to SendState.ON_PHONE_ONLY), states(p))
        assertEquals(StatusMessage.RESTORED, p.data.sender.status().sync.message)
        assertEquals("active", srv.state.shifts[sid(0)]!!.status) // no `end` before the fixes

        srv.overrides.clear()
        val from = srv.calls.size
        p.data.sendNow()
        assertEquals(700, fixesSent(srv, sid(0), from)) // only what was not accepted yet
        assertEquals(1_200, srv.state.points[sid(0)]!!.size)
        assertEquals("ended", srv.state.shifts[sid(0)]!!.status)
        assertEquals(mapOf(sid(0) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }

    @Test
    fun offlineEverythingStaysSurvivesARestartAndGoesWhenTheServerIsBack() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 250)
        srv.restore(empty)
        // The restore is seen on the settings answer; then the connection drops.
        p.data.pairing.refreshSettings(p.data.pairing.load()!!)
        assertEquals(StatusMessage.RESTORED, p.data.sender.status().sync.message)
        p.net.down = true
        assertFalse(p.data.sendNow())
        assertEquals(mapOf(sid(0) to SendState.ON_PHONE_ONLY), states(p))
        assertEquals(listOf(ResendMark(sid(0), 2, ResendMark.Phase.TODO, 0)), p.data.store.resendMarks())

        // The app is closed and opened again: the marks are in the database, so the notice is back at once.
        p.db.close()
        val again = phone(srv, p.dbFile, p.clock)
        assertEquals(StatusMessage.RESTORED, again.data.sender.status().sync.message)
        again.data.sendNow()
        assertEquals(250, srv.state.points[sid(0)]!!.size)
        assertEquals(mapOf(sid(0) to SendState.SENT), states(again))
        assertNull(again.data.sender.status().sync.message)
    }

    @Test
    fun aSecondRestoreWhileSendingAgainStartsOverAndBothShiftsEndUpOnTheServer() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 300)
        record(p, 1, 900)
        srv.restore(empty)
        var twice = false
        srv.overrides["POST /telemetry/batch"] = { c ->
            if (!twice && (c.body as JsonObject)["shift_client_id"]!!.jsonPrimitive.content == sid(1) && srv.state.shifts.containsKey(sid(1))) {
                // Stored, then the server is restored again from the same backup before it answers.
                twice = true
                srv.restore(empty)
                srv.ok(200, kotlinx.serialization.json.buildJsonObject {
                    put("inserted", kotlinx.serialization.json.JsonPrimitive(0)); put("duplicates", kotlinx.serialization.json.JsonPrimitive(0))
                    put("rejected", kotlinx.serialization.json.JsonArray(emptyList())); put("server_time", kotlinx.serialization.json.JsonPrimitive(1))
                    put("upload_hint_s", kotlinx.serialization.json.JsonPrimitive(60))
                })
            } else {
                null
            }
        }
        assertTrue(p.data.sendNow())
        assertTrue(twice)
        assertEquals(3L, srv.gen)
        assertEquals(300, srv.state.points[sid(0)]!!.size)
        assertEquals(900, srv.state.points[sid(1)]!!.size)
        assertTrue(srv.state.shifts.values.all { it.status == "ended" })
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(1) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }

    @Test
    fun theRunningShiftIsSentAgainFirstEndedShiftsWaitUntilItEndsTheirFixesKept() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 100)
        p.clock.t = base + 2 * day
        p.data.startShift(3)
        p.record((0 until 50).map { j -> drive(p.clock.t + 1_000 + j * 1_000L, 1, startLat = 400_000_000L + j * 3_000)[0] })
        p.clock.t += 60_000
        p.data.sendNow()
        assertEquals(50, srv.state.points[sid(1)]!!.size)

        // Weeks later: the phone would let go of fixes acknowledged 14 days ago, but not while a restore asks for them.
        p.clock.t = base + 20 * day
        srv.restore(empty)
        p.data.sendNow()
        assertEquals("active", srv.state.shifts[sid(1)]!!.status)
        assertEquals(50, srv.state.points[sid(1)]!!.size)
        assertFalse(srv.state.shifts.containsKey(sid(0))) // waits: it would be a second active shift
        assertEquals(listOf(ResendMark(sid(0), 2, ResendMark.Phase.TODO, 0)), p.data.store.resendMarks())
        assertEquals(100, p.data.fixStore.fixesFor(sid(0)).size)

        p.data.endShift()
        p.data.sendNow()
        assertEquals(0, srv.conflicts)
        assertEquals(100, srv.state.points[sid(0)]!!.size)
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(1) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }

    @Test
    fun aShiftKnownOnlyFromTheServerFeedIsNotSentAndStaysSent() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        record(p, 0, 50)
        p.data.store.upsertShift(
            ShiftRecord(
                clientId = sid(9), serverId = 9, vehicleId = 3, status = ShiftStatus.ENDED, segmenter = app.milewage.core.api.Segmenter.WHOLE_SHIFT,
                startedAt = base - day, endedAt = base - day + 3_600_000, localDate = "2023-11-10",
                distances = app.milewage.core.shift.Distances(5_000, 5_000, 0, 0), calcSource = CalcSource.SERVER, updatedAt = 1, sendState = SendState.SENT,
            ),
        )
        srv.restore(empty)
        p.data.sendNow()
        val created = srv.calls.filter { it.method == "POST" && it.path == "/shifts" }.map { (it.body as JsonObject)["client_id"]!!.jsonPrimitive.content }
        assertFalse(sid(9) in created)
        assertEquals(mapOf(sid(0) to SendState.SENT, sid(9) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }

    @Test
    fun workQueuedBeforeTheRestoreWaitsUntilTheServerHasTheShiftAgainNeverParked() = runBlocking {
        val srv = server()
        val empty = srv.backup()
        val p = phone(srv)
        p.data.startShift(3)
        p.data.sendNow() // created on the server
        p.record((0 until 80).map { j -> drive(base + 1_000 + j * 10_000L, 1, startLat = 400_000_000L + j * 3_000)[0] })
        p.clock.t = base + 900_000
        p.net.down = true // ended offline: fixes, the end reading and `end` stay queued
        p.data.endShift(120_050_000)
        p.data.sendNow()
        p.net.down = false

        srv.restore(empty)
        p.data.pairing.refreshSettings(p.data.pairing.load()!!)
        val from = srv.calls.size
        p.data.sendNow()
        val sent = srv.calls.drop(from).map { it.toString() }
        assertTrue(sent.indexOf("POST /shifts") in 0 until sent.indexOf("PUT /shifts/${sid(0)}/odometer/shift_end"), sent.toString())
        assertEquals(80, srv.state.points[sid(0)]!!.size)
        assertEquals(120_050_000L, srv.state.odometer["${sid(0)}:shift_end"])
        assertEquals("ended", srv.state.shifts[sid(0)]!!.status)
        assertEquals(StatusColor.GREEN, p.data.sender.status().sync.color)
        assertEquals(mapOf(sid(0) to SendState.SENT), states(p))
        assertEquals(emptyList(), p.data.store.resendMarks())
    }
}
