package app.milewage.data.sync

import app.milewage.core.api.ApiJson
import app.milewage.core.api.Settings
import app.milewage.core.shift.SendState
import app.milewage.core.sync.Progress
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.ID
import app.milewage.data.support.Phone.Companion.drive
import app.milewage.data.support.Phone.Companion.sid
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Fixes in batches and the backlog drain (ports of the Expo app's points.test.ts and drain.test.ts). */
class UploadTest {
    private val servers = ArrayList<FakeMileWage>()
    private val day = 86_400_000L
    private val base = 1_700_000_000_000L

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    private fun batches(srv: FakeMileWage, shift: String? = null) = srv.calls
        .filter { it.path == "/telemetry/batch" && (shift == null || (it.body as JsonObject)["shift_client_id"]!!.jsonPrimitive.content == shift) }
        .map { (it.body as JsonObject)["points"]!!.jsonArray.map { p -> p.jsonObject["seq"]!!.jsonPrimitive.long } }

    @Test
    fun theRunningShiftGoesInBatchesOf100InSeqOrderAndIsMarkedSent() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 250))
        p.data.sendNow()
        val b = batches(srv)
        assertEquals(listOf(100, 100, 50), b.map { it.size })
        assertEquals((1L..250).toList(), b.flatten())
        assertEquals(0L, p.data.store.pendingCount())
        // The wire carries only the contract's fields: provider and phone time stay on the phone.
        val point = (srv.calls.first { it.path == "/telemetry/batch" }.body as JsonObject)["points"]!!.jsonArray[0].jsonObject
        assertEquals(setOf("seq", "recorded_at", "lat_e7", "lon_e7", "accuracy_m"), point.keys) // null speed, bearing, altitude are left out
    }

    @Test
    fun anEndedShiftGoesIn500sAndNoRequestCarriesMore() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.net.down = true
        p.data.startShift(3)
        p.record(drive(2_000, 1_200))
        p.data.endShift()
        p.net.down = false
        assertTrue(p.data.sendNow())
        assertEquals(listOf(500, 500, 200), batches(srv).map { it.size })
    }

    @Test
    fun fixesTheServerRejectsAreSetAsideNeverSentAgainTheRestGo() = runBlocking {
        val srv = server()
        var first = true
        srv.overrides["POST /telemetry/batch"] = { c ->
            if (!first) {
                null
            } else {
                first = false
                val pts = (c.body as JsonObject)["points"]!!.jsonArray
                for (pt in pts) srv.state.points.getOrPut(ID) { HashSet() }.add(pt.jsonObject["seq"]!!.jsonPrimitive.long)
                srv.ok(200, buildJsonObject {
                    put("inserted", pts.size - 2); put("duplicates", 0); put("server_time", 1); put("upload_hint_s", 60)
                    put("rejected", buildJsonArray {
                        add(buildJsonObject { put("seq", 2); put("code", "invalid_coordinate") })
                        add(buildJsonObject { put("seq", 4); put("code", "future_timestamp") })
                    })
                })
            }
        }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 6))
        p.data.sendNow()
        p.record(drive(70_000, 2))
        p.data.sendNow()
        assertEquals(listOf(listOf(1L, 2, 3, 4, 5, 6), listOf(7L, 8)), batches(srv))
        assertEquals(listOf(1L, 3, 5, 6, 7, 8), p.data.fixStore.fixesFor(ID).map { it.seq }) // set aside: kept, out of the result
        assertEquals(0L, p.data.store.pendingCount())
    }

    @Test
    fun tooLargeHalvesTheBatchAndInvalidFindsTheBadFixWithoutHoldingBackTheRest() = runBlocking {
        val srv = server()
        srv.overrides["POST /telemetry/batch"] = { c ->
            val seqs = (c.body as JsonObject)["points"]!!.jsonArray.map { it.jsonObject["seq"]!!.jsonPrimitive.long }
            when {
                seqs.size > 300 -> srv.problem(413, "payload_too_large")
                3L in seqs -> srv.problem(422, "validation_failed")
                else -> null
            }
        }
        val p = Phone(srv)
        p.net.down = true
        p.data.startShift(3)
        p.record(drive(2_000, 600))
        p.data.endShift()
        p.net.down = false
        assertTrue(p.data.sendNow())
        val sizes = batches(srv).map { it.size }
        assertEquals(500, sizes[0])
        assertEquals(250, sizes[1])
        assertTrue(1 in sizes) // halved down to the one bad fix, which is set aside
        assertEquals<Set<Long>?>((1L..600).toSet() - 3L, srv.state.points[ID])
        assertEquals(SendState.SENT, p.data.store.shift(ID)!!.sendState)
    }

    @Test
    fun shiftNotFoundIsTried3TimesThenWaitsWithoutDroppingAndPairingAgainTriesAgain() = runBlocking {
        val srv = server()
        srv.overrides["POST /telemetry/batch"] = { srv.problem(404, "shift_not_found") }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 4))
        repeat(4) { p.data.sendNow() }
        assertEquals(3, batches(srv).size)
        assertEquals(4L, p.data.store.pendingCount())
        p.data.pairing.device.resume()
        srv.overrides.clear()
        p.data.sendNow()
        assertEquals(0L, p.data.store.pendingCount())
    }

    @Test
    fun shiftFinalizedSetsTheFixesAside() = runBlocking {
        val srv = server()
        srv.overrides["POST /telemetry/batch"] = { srv.problem(409, "shift_finalized") }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 3))
        p.data.sendNow()
        assertEquals(0L, p.data.store.pendingCount())
        assertEquals(emptyList(), p.data.fixStore.fixesFor(ID))
    }

    @Test
    fun trackingOffOnTheServerSendsNoFixes() = runBlocking {
        val srv = server()
        val off = ApiJson.decodeFromJsonElement(
            Settings.serializer(),
            JsonObject(FakeMileWage.SETTINGS + ("modules" to buildJsonObject { put("tracking", false); put("sync", true) })),
        )
        srv.settings = ApiJson.encodeToJsonElement(Settings.serializer(), off).jsonObject
        val p = Phone(srv, settings = off)
        p.data.startShift(3)
        assertEquals(null, p.recorder.recordingId) // the tracker is not started at all
        p.data.fixStore.append(ID, drive(2_000, 3))
        p.data.sendNow()
        assertEquals(0, batches(srv).size)
        assertTrue(srv.writes().contains("POST /shifts"))
    }

    @Test
    fun aRunningShiftWhoseCreateIsNotAcknowledgedSendsNoFixes() = runBlocking {
        val srv = server()
        srv.overrides["POST /shifts"] = { srv.problem(503, "unavailable", retryable = true) }
        val p = Phone(srv)
        p.data.startShift(3)
        p.record(drive(2_000, 3))
        assertFalse(p.data.sendNow())
        assertEquals(0, batches(srv).size)
        assertEquals(3L, p.data.store.pendingCount())
    }

    /** [n] shifts of [fixes] fixes each, one day apart, recorded and ended with no connection. */
    private suspend fun backlog(srv: FakeMileWage, n: Int, fixes: Int): Phone {
        val p = Phone(srv, ids = (0 until n + 1).map(::sid))
        p.net.down = true
        for (k in 0 until n) {
            p.clock.t = base + k * day
            p.data.startShift(3)
            p.record((0 until fixes).map { j -> drive(p.clock.t + 1_000 + j * 10_000L, 1, startLat = 400_000_000L + j * 3_000)[0] })
            p.clock.t += fixes * 10_000L + 5_000
            p.data.endShift()
        }
        p.net.down = false
        return p
    }

    private fun log(srv: FakeMileWage) = srv.calls.filter { it.method != "GET" }.map { c ->
        val b = c.body as? JsonObject
        when {
            c.path == "/shifts" -> "create ${b!!["client_id"]!!.jsonPrimitive.content}"
            c.path == "/telemetry/batch" -> "points ${b!!["shift_client_id"]!!.jsonPrimitive.content} ${b["points"]!!.jsonArray.size}"
            c.path.endsWith("/end") -> "end ${c.path.split('/')[2]}"
            else -> c.toString()
        }
    }

    @Test
    fun twentyFourOfflineShiftsDrainOldestFirstEachAsCreateFixesEndNothingLostOrDoubled() = runBlocking {
        val srv = server()
        val p = backlog(srv, 24, 600)
        assertEquals(24, p.data.sender.status().sync.unsentShifts)
        assertTrue(p.data.sendNow())
        val l = log(srv)
        for (i in 0 until 24) {
            val mine = l.filter { it.contains(sid(i)) }
            assertEquals(listOf("create ${sid(i)}", "points ${sid(i)} 500", "points ${sid(i)} 100", "end ${sid(i)}"), mine)
        }
        // Shift 0 completely, then shift 1, and so on.
        val order = l.map { it.split(' ')[1] }
        assertEquals(order.sortedBy { it }, order)
        assertEquals(0, srv.duplicates)
        assertTrue(srv.state.points.values.all { it.size == 600 })
        assertEquals(0L, p.data.store.pendingCount())
        assertTrue(p.data.store.shifts().all { it.sendState == SendState.SENT })
        val progress = p.data.sender.status().progress
        assertEquals(Progress.Phase.DONE, progress.phase)
        assertEquals(24 * 600, progress.fixesSent)
        assertEquals(24, progress.shiftsDone)
        assertEquals(24, progress.shiftsTotal)
    }

    @Test
    fun cancelStopsBetweenRequestsAndTheNextDrainResumesWithNoLossAndNoDuplicate() = runBlocking {
        val srv = server()
        lateinit var p: Phone
        var telemetry = 0
        srv.overrides["POST /telemetry/batch"] = {
            if (++telemetry == 4) p.data.cancelSending()
            null
        }
        p = backlog(srv, 4, 1_200)
        assertFalse(p.data.sendNow())
        assertEquals(Progress.Phase.CANCELLED, p.data.sender.status().progress.phase)
        assertEquals(4, batches(srv).size)
        assertTrue(p.data.store.pendingCount() > 0)
        assertTrue(p.data.sendNow())
        assertEquals(0, srv.duplicates)
        assertEquals(List(4) { 1_200 }, srv.state.points.values.map { it.size })
    }

    @Test
    fun theEndWaitsForAFailedBatchAndNothingAfterItGoesUntilTheServerIsBack() = runBlocking {
        val srv = server()
        var fail = true
        srv.overrides["POST /telemetry/batch"] = { c ->
            val b = c.body as JsonObject
            if (fail && b["shift_client_id"]!!.jsonPrimitive.content == sid(1) && b["points"]!!.jsonArray.size == 200) srv.problem(503, "unavailable", true) else null
        }
        val p = backlog(srv, 3, 700)
        assertFalse(p.data.sendNow())
        assertEquals(Progress.Phase.WAITING, p.data.sender.status().progress.phase)
        val l = log(srv)
        assertFalse(l.contains("end ${sid(1)}"))
        assertFalse(l.any { it.contains(sid(2)) })
        assertTrue(l.contains("end ${sid(0)}"))
        fail = false
        assertTrue(p.data.sendNow())
        assertEquals(listOf("end ${sid(0)}", "end ${sid(1)}", "end ${sid(2)}"), log(srv).filter { it.startsWith("end") })
        assertEquals(0, srv.duplicates)
    }

    @Test
    fun withARunningShiftTheOlderShiftsAreOpenedAndClosedFirstSoTheServerRefusesNone() = runBlocking {
        val srv = server()
        val p = backlog(srv, 2, 1_200)
        p.clock.t = base + 10 * day
        p.data.startShift(3)
        val live = p.data.shifts.running()!!.clientId
        p.record((0 until 5).map { j -> drive(p.clock.t + j * 10_000L, 1, startLat = 410_000_000)[0] })
        p.data.sendNow()
        assertEquals(0, srv.conflicts) // the server never refused a create
        val l = log(srv)
        assertTrue(l.indexOf("create $live") > l.indexOf("end ${sid(1)}"), l.toString())
        assertEquals(listOf("ended", "ended", "active"), srv.state.shifts.values.map { it.status })
        assertEquals(5, srv.state.points[live]!!.size)
        assertTrue(p.data.store.shifts().filter { it.clientId != live }.all { it.sendState == SendState.SENT })
    }

    @Test
    fun anOlderShiftWhoseCreateIsRefusedBecauseTheRunningOneIsOpenWaitsForItInsteadOfBeingParked() = runBlocking {
        val srv = server()
        val p = Phone(srv, ids = listOf(sid(0), sid(1)))
        // Shift 0 ended offline; shift 1 started online and its create reached the server first.
        p.net.down = true
        p.data.startShift(3)
        p.clock.t += 60_000
        p.data.endShift()
        p.net.down = false
        p.data.startShift(3)
        srv.overrides["POST /shifts"] = null.let { { c ->
            if ((c.body as JsonObject)["client_id"]!!.jsonPrimitive.content == sid(1)) null else null
        } }
        // Force the order of the Expo app: the running shift's create first.
        srv.state.shifts[sid(1)] = FakeMileWage.ShiftRow(500, sid(1), 3, p.clock.t)
        p.data.sender.outbox.pending().filter { it.shiftClientId == sid(1) }.forEach { p.data.store.deleteChange(it.id) }
        assertFalse(p.data.sendNow())
        assertEquals(0, p.data.sender.outbox.counts().parked)
        assertEquals(SendState.ON_PHONE_ONLY, p.data.store.shift(sid(0))!!.sendState)
        // The running shift ends: the older one goes now.
        p.data.endShift()
        assertTrue(p.data.sendNow())
        assertEquals(SendState.SENT, p.data.store.shift(sid(0))!!.sendState)
    }
}
