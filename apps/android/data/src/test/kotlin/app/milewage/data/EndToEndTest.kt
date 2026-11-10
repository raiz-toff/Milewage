package app.milewage.data

import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.StartResult
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.core.tracking.RecordedFix
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.ID
import app.milewage.data.support.TestDb
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The whole phone on the JVM against a real HTTP server: start a shift, the tracker's fixes, end it
 * (the engine runs), the outbox drains in order, the server's answer is stored, a change from the
 * server arrives through the change log. Then the same shift with the server unreachable from start
 * to end and reachable later: nothing is lost and the server gets the same requests.
 */
class EndToEndTest {
    private val servers = ArrayList<FakeMileWage>()
    private val base = 1_762_000_000_000L

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    /** An hour of driving with two stops, delivered by the tracker 3 fixes at a time at a 5 s cadence. */
    private fun hour(from: Long): List<RecordedFix> = Synthetic.shift(from, hours = 1)

    private suspend fun recordShift(p: Phone, midSend: Boolean): List<RecordedFix> {
        p.clock.t = base
        assertIs<StartResult.Started>(p.data.startShift(vehicleId = 3, odometerStartM = 50_000))
        val fixes = hour(base + 1_000)
        val stored = ArrayList<RecordedFix>()
        for ((i, batch) in fixes.chunked(3).withIndex()) {
            p.clock.t = batch.last().recordedAt
            stored += p.record(batch)
            if (midSend && i == 200) p.data.sendNow()
        }
        p.clock.t = fixes.last().recordedAt + 30_000
        val end = p.data.endShift(odometerEndM = 75_000)
        assertIs<EndResult.Ended>(end)
        assertNotNull(end.run, "the engine ran at the end")
        return stored
    }

    @Test
    fun aShiftGoesOutInOrderTheServersAnswerIsStoredAndAChangeArrives() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        val stored = recordShift(p, midSend = true)

        val local = p.data.store.shift(ID)!!
        assertEquals(CalcSource.PHONE, local.calcSource)
        val phoneTotal = local.distances!!.totalM
        assertTrue(phoneTotal > 25_000, "an hour of driving: $phoneTotal m")
        assertTrue(p.data.store.trips(ID).isNotEmpty())
        assertEquals(stored.size.toLong(), local.manifest!!.pointCount)

        assertTrue(p.data.sendNow())
        val writes = srv.writes().filter { it != "POST /telemetry/batch" }
        assertEquals(
            listOf("POST /shifts", "PUT /shifts/$ID/odometer/shift_start", "PUT /shifts/$ID/odometer/shift_end", "POST /shifts/$ID/end"),
            writes,
        )
        val all = srv.writes()
        assertTrue(all.lastIndexOf("POST /telemetry/batch") < all.indexOf("POST /shifts/$ID/end"), "the end waits for the last fix")
        assertEquals<Set<Long>?>(stored.map { it.seq }.toSet(), srv.state.points[ID])
        assertEquals(0, srv.duplicates)
        val endBody = srv.calls.last { it.path == "/shifts/$ID/end" }.body as kotlinx.serialization.json.JsonObject
        assertEquals(phoneTotal, (endBody["phone_result"] as kotlinx.serialization.json.JsonObject)["total_m"]!!.jsonPrimitive.long)

        val sent = p.data.store.shift(ID)!!
        assertEquals(SendState.SENT, sent.sendState)
        assertEquals(CalcSource.SERVER, sent.calcSource)
        assertEquals(ReconStatus.MATCH, sent.recon)
        assertEquals(100L, sent.serverId)
        assertEquals(StatusColor.GREEN, p.data.sender.status().sync.color)

        // The server recalculates (a label on the web, say) and the change log brings its number.
        srv.changes += buildJsonObject {
            put("seq", 1)
            put("entity", "shift")
            put("op", "upsert")
            put("key", ID)
            put("data", kotlinx.serialization.json.JsonObject(srv.shiftJson(srv.state.shifts[ID]!!) + ("total_m" to kotlinx.serialization.json.JsonPrimitive(phoneTotal + 250))))
        }
        p.data.sendNow()
        val pulled = p.data.store.shift(ID)!!
        assertEquals(phoneTotal + 250, pulled.distances!!.totalM)
        val diff = p.data.store.overwrites(ID).single()
        assertEquals(OverwriteReason.RECON_DIFF, diff.reason)
        assertTrue(diff.localJson.contains("\"total_m\":$phoneTotal"))
    }

    @Test
    fun unreachableForTheWholeShiftNothingIsLostAndTheSameRequestsGoLater() = runBlocking {
        val onlineSrv = server()
        val first = Phone(onlineSrv)
        val stored = recordShift(first, midSend = false)
        assertTrue(first.data.sendNow())

        val offlineSrv = server()
        val file = TestDb.file()
        val p = Phone(offlineSrv, dbFile = file)
        p.net.down = true
        val storedOffline = recordShift(p, midSend = true)
        assertFalse(p.data.sendNow())
        assertEquals(stored.map { it.seq }, storedOffline.map { it.seq })
        val status = p.data.sender.status().sync
        assertEquals(1, status.unsentShifts)
        assertEquals(storedOffline.size.toLong(), status.unsentFixes)
        assertEquals(StatusMessage.OFFLINE, status.message)
        assertEquals(emptyList(), offlineSrv.writes())

        // The app is closed and opened again; later the server is reachable.
        p.db.close()
        val again = Phone(offlineSrv, dbFile = file, clock = p.clock)
        assertEquals(1, again.data.sender.status().sync.unsentShifts)
        assertTrue(again.data.sendNow())
        assertEquals<Set<Long>?>(storedOffline.map { it.seq }.toSet(), offlineSrv.state.points[ID])
        assertEquals(SendState.SENT, again.data.store.shift(ID)!!.sendState)

        // The same requests as when the server was there all along (fix batches aside: sizes differ).
        fun shape(s: FakeMileWage) = s.calls.filter { it.method != "GET" && it.path != "/telemetry/batch" }.map { "$it ${it.body}" }
        assertEquals(shape(onlineSrv), shape(offlineSrv))
        assertEquals(onlineSrv.state.points[ID], offlineSrv.state.points[ID])
    }

    @Test
    fun aTwelveHourShiftEndsOffTheMainThreadAndItsEngineRunIsTimed() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.clock.t = base
        p.data.startShift(3)
        val fixes = Synthetic.shift(base + 1_000, hours = 12)
        for (batch in fixes.chunked(3)) p.record(batch)
        p.clock.t = fixes.last().recordedAt + 5_000
        val t0 = System.nanoTime()
        val end = p.data.endShift() as EndResult.Ended
        val wallMs = (System.nanoTime() - t0) / 1_000_000
        val run = end.run!!
        // The engine alone, warmed up, several times.
        val shift = p.data.store.shift(ID)!!
        val stored = p.data.fixStore.fixesFor(ID)
        val input = app.milewage.core.shift.ShiftRun.input(shift.copy(), shift.endedAt!!, stored, emptyList())
        repeat(3) { app.milewage.core.shift.ShiftRun.run(input, shift.segmenter) }
        val times = (1..5).map {
            val s = System.nanoTime()
            app.milewage.core.shift.ShiftRun.run(input, shift.segmenter)
            (System.nanoTime() - s) / 1_000_000
        }
        val report = "12-hour shift: ${fixes.size} fixes, ${run.result.trips.size} trips, ${run.result.stops.size} stops, " +
            "${run.result.totals.totalM} m; end() ${wallMs} ms (first run, cold JVM, engine ${shift.engineMs} ms); engine warm ${times.sorted()} ms"
        println(report)
        java.io.File("build/engine-timing.txt").writeText(report + "\n")
        assertEquals(8_640, fixes.size)
        assertTrue(run.result.stops.isNotEmpty())
    }
}

/** Synthetic shifts: 15 minutes of driving at about 40 km/h, then a 5-minute stop, repeated; fixes every 5 s. */
object Synthetic {
    fun shift(from: Long, hours: Int): List<RecordedFix> {
        val out = ArrayList<RecordedFix>()
        var lat = 450_000_000L
        var lon = -735_000_000L
        var t = from
        val end = from + hours * 3_600_000L
        var i = 0
        while (t < end) {
            val inCycle = ((t - from) / 1000) % 1200
            val moving = inCycle < 900
            if (moving) {
                // About 55 m per 5 s, turning slowly.
                val heading = (i / 120) % 4
                when (heading) {
                    0 -> lat += 5_000
                    1 -> lon += 7_000
                    2 -> lat -= 5_000
                    else -> lon -= 7_000
                }
            }
            val jitter = if (moving) 0 else ((i * 37) % 7 - 3).toLong() * 10
            out += RecordedFix(0, "", t, lat + jitter, lon - jitter, 5L + i % 6, if (moving) 110 else 0, null, null, "gps", null, t + 300)
            t += 5_000
            i++
        }
        return out
    }
}
