package app.milewage.data.sync

import app.milewage.core.api.TripKind
import app.milewage.core.pairing.HaltReason
import app.milewage.core.pairing.PairingLink
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.SendState
import app.milewage.core.sync.Progress
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.B
import app.milewage.data.support.Phone.Companion.ID
import app.milewage.data.support.Phone.Companion.drive
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.After
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Sending, at the sender's interface (a port of the Expo app's sender.test.ts): what the shift model
 * and the edits queued goes out in order, the end waits for the shift's fixes, refusals and halts
 * keep everything, re-pairing sends it all without a restart, and the banner reads one status.
 */
class SenderTest {
    private val servers = ArrayList<FakeMileWage>()

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    /** A shift recorded and ended with no connection: its create, readings and end wait on the phone. */
    private suspend fun endedOffline(srv: FakeMileWage = server(), start: Long? = null, end: Long? = null, fixes: Boolean = false, phone: Phone = Phone(srv)): Phone {
        phone.net.down = true
        phone.data.startShift(3, start)
        if (fixes) phone.record(drive(1_000, 5))
        phone.clock.t = 100_000
        phone.data.endShift(end)
        assertFalse(phone.data.sendNow())
        phone.net.down = false
        return phone
    }

    private fun body(srv: FakeMileWage, i: Int) = srv.calls.filter { it.method != "GET" }[i].body as JsonObject

    @Test
    fun aShiftEndedOfflineGoesAsCreateReadingsFixesThenEndWithTheExactBodies() = runBlocking {
        val srv = server()
        val p = endedOffline(srv, start = 50_000, end = 55_000, fixes = true)
        assertEquals(1, p.data.sender.status().sync.unsentShifts)
        assertTrue(p.data.sendNow())
        assertEquals(
            listOf("POST /shifts", "PUT /shifts/$ID/odometer/shift_start", "PUT /shifts/$ID/odometer/shift_end", "POST /telemetry/batch", "POST /shifts/$ID/end"),
            srv.writes(),
        )
        assertEquals(buildJsonObject { put("client_id", ID); put("vehicle_id", 3); put("started_at", 1_000); put("segmenter", "stops") }, body(srv, 0))
        assertEquals(buildJsonObject { put("reading_m", 50_000); put("recorded_at", 1_000) }, body(srv, 1))
        assertEquals(buildJsonObject { put("reading_m", 55_000); put("recorded_at", 100_000) }, body(srv, 2))
        assertEquals(100_000, body(srv, 4)["ended_at"]!!.jsonPrimitive.long)
        assertEquals(5, (body(srv, 4)["manifest"] as JsonObject)["point_count"]!!.jsonPrimitive.long)
        val s = p.data.sender.status().sync
        assertEquals(StatusColor.GREEN, s.color)
        assertEquals(0, s.unsentShifts)
        assertNull(s.message)
        assertEquals(SendState.SENT, p.data.store.shift(ID)!!.sendState)
    }

    @Test
    fun aReadingChangedTwiceOfflineIsSentOnceWithTheNewerValue() = runBlocking {
        val srv = server()
        val p = endedOffline(srv, end = 55_000)
        p.data.setOdometer(ID, OdometerKind.SHIFT_END, 56_000)
        p.data.setOdometer(ID, OdometerKind.SHIFT_END, 57_000)
        assertTrue(p.data.sendNow())
        val readings = srv.calls.filter { it.path.endsWith("/odometer/shift_end") }
        assertEquals(listOf(57_000L), readings.map { (it.body as JsonObject)["reading_m"]!!.jsonPrimitive.long })
        assertEquals(1, srv.writes().count { it == "POST /shifts/$ID/end" })
    }

    @Test
    fun anEditMadeWhileTheEarlierOneIsBeingSentIsNotLost() = runBlocking {
        val srv = server()
        lateinit var p: Phone
        var edit = true
        srv.overrides["PUT /shifts/$ID/odometer/shift_end"] = {
            if (edit) {
                edit = false
                runBlocking { p.data.setOdometer(ID, OdometerKind.SHIFT_END, 2_000) }
            }
            null
        }
        p = Phone(srv)
        endedOffline(srv, end = 1_000, phone = p)
        assertTrue(p.data.sendNow())
        val readings = srv.calls.filter { it.path.endsWith("/odometer/shift_end") }
        assertEquals(listOf(1_000L, 2_000L), readings.map { (it.body as JsonObject)["reading_m"]!!.jsonPrimitive.long })
    }

    @Test
    fun oneRoundAtATimeASecondCallWaitsForTheFirstAndThenLooksAgain() = runBlocking {
        val srv = server()
        val gate = CountDownLatch(1)
        srv.overrides["POST /shifts"] = {
            gate.await(5, TimeUnit.SECONDS)
            null
        }
        val p = endedOffline(srv)
        coroutineScope {
            val first = async(kotlinx.coroutines.Dispatchers.IO) { p.data.sendNow() }
            delay(100)
            val second = async(kotlinx.coroutines.Dispatchers.IO) { p.data.sendNow() }
            delay(100)
            gate.countDown()
            assertTrue(first.await())
            assertTrue(second.await())
        }
        assertEquals(listOf("POST /shifts", "POST /shifts/$ID/end"), srv.writes())
    }

    @Test
    fun notPairedNothingIsSentAndNothingIsLost() = runBlocking {
        val srv = server()
        val p = endedOffline(srv)
        assertTrue(p.data.unpair(loseUnsentData = true))
        val from = srv.calls.size
        assertFalse(p.data.sendNow())
        assertEquals(from, srv.calls.size)
        assertEquals(1, p.data.sender.status().sync.unsentShifts)
    }

    @Test
    fun unpairingIsRefusedWhileDataWaits() = runBlocking {
        val p = endedOffline()
        assertTrue(p.data.hasUnsentData())
        assertFalse(p.data.unpair())
        assertTrue(p.data.sendNow())
        assertFalse(p.data.hasUnsentData())
        assertTrue(p.data.unpair())
    }

    @Test
    fun aChangeTheServerRefusesIsKeptAndHoldsBackOnlyItsOwnShift() = runBlocking {
        val srv = server()
        srv.overrides["POST /shifts"] = { c ->
            if ((c.body as JsonObject)["client_id"]!!.jsonPrimitive.content == ID) srv.problem(409, "shift_already_active") else null
        }
        val p = Phone(srv, ids = listOf(ID, B))
        p.net.down = true
        for (i in 0..1) {
            p.data.startShift(3)
            p.clock.t += 60_000
            p.data.endShift()
        }
        p.net.down = false
        assertFalse(p.data.sendNow())
        assertEquals(listOf("POST /shifts", "POST /shifts", "POST /shifts/$B/end"), srv.writes())
        assertEquals(SendState.NEEDS_ATTENTION, p.data.store.shift(ID)!!.sendState)
        assertEquals(SendState.SENT, p.data.store.shift(B)!!.sendState)
        assertEquals(StatusColor.RED, p.data.sender.status().sync.color)
        assertEquals(StatusMessage.NEEDS_ATTENTION, p.data.sender.status().sync.message)
        // Never sent again by itself; the driver's retry sends it (the server now takes it).
        val from = srv.calls.size
        assertFalse(p.data.sendNow())
        assertEquals(emptyList(), srv.writes(from))
        srv.overrides.clear()
        assertTrue(p.data.retrySending())
        assertEquals(listOf("POST /shifts", "POST /shifts/$ID/end"), srv.writes(from))
        assertEquals(SendState.SENT, p.data.store.shift(ID)!!.sendState)
    }

    @Test
    fun shiftFinalizedOnAnEditIsFinal() = runBlocking {
        val srv = server()
        srv.overrides["PATCH /shifts/$ID"] = { srv.problem(409, "shift_finalized") }
        val p = Phone(srv)
        p.data.startShift(3)
        p.data.endShift()
        assertTrue(p.data.sendNow())
        p.data.setNotes(ID, "late note")
        assertTrue(p.data.sendNow())
        p.data.sendNow()
        assertEquals(1, srv.calls.count { it.method == "PATCH" })
    }

    @Test
    fun whatWaitsSurvivesAnAppRestartAndGoesWhenTheServerIsBack() = runBlocking {
        val srv = server()
        val first = endedOffline(srv, end = 9_000)
        first.db.close()
        val again = Phone(srv, dbFile = first.dbFile)
        assertTrue(again.data.sendNow())
        assertEquals(listOf("POST /shifts", "PUT /shifts/$ID/odometer/shift_end", "POST /shifts/$ID/end"), srv.writes())
    }

    @Test
    fun theEndWaitsForTheFixesAFailedBatchHoldsItBack() = runBlocking {
        val srv = server()
        var up = false
        srv.overrides["POST /telemetry/batch"] = { if (up) null else srv.problem(503, "unavailable", retryable = true) }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 2))
        p.clock.t = 30_000
        p.data.endShift()
        assertFalse(p.data.sendNow())
        assertFalse(srv.writes().any { it.endsWith("/end") })
        assertEquals(2L, p.data.store.pendingCount())
        up = true
        assertTrue(p.data.sendNow())
        assertEquals("POST /shifts/$ID/end", srv.writes().last())
        assertEquals(1, srv.writes().count { it.endsWith("/end") })
        assertEquals(0L, p.data.store.pendingCount())
    }

    @Test
    fun revokedNothingMoreGoesOutEverythingIsKeptAndPairingAgainSendsItAllWithoutARestart() = runBlocking {
        val srv = server()
        var revoked = true
        srv.overrides["POST /shifts"] = { if (revoked) srv.problem(401, "device_revoked") else null }
        val p = endedOffline(srv, fixes = true)
        assertFalse(p.data.sendNow())
        val st = p.data.sender.status().sync
        assertEquals(HaltReason.REPAIR, st.halt)
        assertEquals(StatusColor.RED, st.color)
        assertEquals(StatusMessage.REVOKED, st.message)
        val from = srv.calls.size
        assertFalse(p.data.sendNow())
        assertEquals(emptyList(), srv.writes(from))
        assertEquals(1, p.data.sender.status().sync.unsentShifts)

        revoked = false
        // Pairing again with a code: the credential is replaced and every halt lifted at once (AR3).
        p.data.pairing.redeem(PairingLink(srv.url, "mwp_" + "a".repeat(43)))
        assertNull(p.data.pairing.device.halted())
        assertTrue(p.data.sendNow())
        assertEquals(listOf("POST /pairing/redeem", "POST /shifts", "POST /telemetry/batch", "POST /shifts/$ID/end"), srv.writes(from))
        assertNull(p.data.sender.status().sync.halt)
    }

    @Test
    fun sendNowLiftsTheHaltAndTriesOnceAServerThatStillRefusesHaltsItAgain() = runBlocking {
        val srv = server()
        srv.overrides["POST /shifts"] = { srv.problem(403, "scope_forbidden") }
        val p = endedOffline(srv)
        assertFalse(p.data.sendNow())
        assertEquals(HaltReason.AUTH_PROBLEM, p.data.sender.status().sync.halt)
        val from = srv.calls.size
        assertFalse(p.data.retrySending())
        assertEquals(listOf("POST /shifts"), srv.writes(from))
        assertEquals(HaltReason.AUTH_PROBLEM, p.data.sender.status().sync.halt)
    }

    @Test
    fun anotherServerAtTheAddressStopsEveryRequestAndKeepsTheData() = runBlocking {
        val srv = server()
        val p = endedOffline(srv)
        srv.instance = "inst-B"
        assertFalse(p.data.sendNow())
        assertEquals(HaltReason.WRONG_SERVER, p.data.sender.status().sync.halt)
        assertEquals(StatusMessage.WRONG_SERVER, p.data.sender.status().sync.message)
        val from = srv.calls.size
        p.data.sendNow()
        assertEquals(from, srv.calls.size) // blocked before anything leaves
        assertEquals(1, p.data.sender.status().sync.unsentShifts)
    }

    @Test
    fun oneStatusNumbersColourSentenceAndTheRoundInProgress() = runBlocking {
        val srv = server()
        val p = endedOffline(srv, fixes = true)
        val s = p.data.sender.status()
        assertEquals(StatusColor.YELLOW, s.sync.color)
        assertEquals(1, s.sync.unsentShifts)
        assertEquals(5L, s.sync.unsentFixes)
        // The create is queued when the shift starts (the Expo app queued it at the end): on the phone only since then.
        assertEquals(1_000L, s.sync.oldestAt)
        assertEquals(StatusMessage.OFFLINE, s.sync.message)
        assertEquals(Progress.Phase.WAITING, s.progress.phase)
        assertTrue(p.data.sendNow())
        val done = p.data.sender.status()
        assertEquals(StatusColor.GREEN, done.sync.color)
        assertEquals(Progress.Phase.DONE, done.progress.phase)
        assertEquals(1, done.progress.shiftsDone)
        assertEquals(1, done.progress.shiftsTotal)
        assertEquals(5, done.progress.fixesSent)
        assertEquals(5L, done.progress.fixesTotal)
    }

    @Test
    fun aRunningShiftTheServerRefusesBecauseAnotherRunsThereKeepsRecordingAndWaits() = runBlocking {
        val srv = server()
        srv.overrides["POST /shifts"] = { srv.problem(409, "shift_already_active") }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 3))
        assertFalse(p.data.sendNow())
        val running = p.data.runningNow()!!
        assertTrue(running.serverHasOtherShift)
        assertEquals(0, p.data.sender.outbox.counts().parked) // kept pending, tried again every round
        assertFalse(srv.writes().contains("POST /telemetry/batch"))
        srv.overrides.clear()
        p.data.sendNow()
        assertFalse(p.data.runningNow()!!.serverHasOtherShift)
        assertEquals(3, srv.state.points[ID]!!.size)
    }

    @Test
    fun manualTripsGoWithAPurposeTheServerTakes() = runBlocking {
        val srv = server()
        val p = Phone(srv, ids = listOf(ID, "AAAAAAAA-0000-4000-8000-000000000000"))
        p.data.startShift(3)
        p.data.endShift()
        assertTrue(p.data.sendNow())
        p.data.addManualTrip(ID, TripKind.ACTIVE, 1_000, 2_000, 3_000)
        assertTrue(p.data.sendNow())
        val put = srv.calls.single { it.method == "PUT" && it.path.startsWith("/shifts/$ID/trips/") }
        assertEquals("/shifts/$ID/trips/aaaaaaaa-0000-4000-8000-000000000000", put.path)
        assertEquals("Business driving", (put.body as JsonObject)["purpose"]!!.jsonPrimitive.content)
        assertEquals(0, p.data.sender.outbox.counts().parked)
        assertEquals(SendState.SENT, p.data.store.shift(ID)!!.sendState)
    }

    private suspend fun waitFor(what: String, ok: suspend () -> Boolean) {
        val until = System.currentTimeMillis() + 10_000
        while (!ok()) {
            if (System.currentTimeMillis() > until) throw AssertionError("timed out waiting for $what")
            delay(20)
        }
    }

    @Test
    fun theLoopSendsAtOnceAndAgainRightAfterPairingAgainWithoutARestart() = runBlocking {
        val srv = server()
        var revoked = true
        srv.overrides["POST /shifts"] = { if (revoked) srv.problem(401, "device_revoked") else null }
        val p = endedOffline(srv)
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default)
        try {
            p.data.sender.start(scope)
            waitFor("the revoke") { p.data.pairing.device.halted() == HaltReason.REPAIR }
            revoked = false
            p.data.pairing.redeem(PairingLink(srv.url, "mwp_" + "b".repeat(43)))
            waitFor("the shift to be sent") { p.data.store.shift(ID)!!.sendState == SendState.SENT }
            // A change queued later goes at once too.
            p.data.setNotes(ID, "flat tyre")
            p.data.kick()
            waitFor("the notes") { srv.calls.any { it.method == "PATCH" } }
        } finally {
            p.data.sender.stop()
            scope.coroutineContext[kotlinx.coroutines.Job]!!.cancel()
        }
    }
}
