package app.milewage.data.sync

import app.milewage.core.api.ChangeType
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.TripKind
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.sync.ChangePuller
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.ID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The change log read into the database (a port of the Expo app's pull.test.ts). */
class PullTest {
    private val servers = ArrayList<FakeMileWage>()

    private fun server() = FakeMileWage().start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    private fun shiftData(vararg over: Pair<String, JsonElement>): JsonObject = JsonObject(
        buildJsonObject {
            put("id", 5); put("client_id", ID); put("vehicle_id", 3); put("status", "ended"); put("started_at", 1_000); put("ended_at", 9_000)
            put("local_date", "2026-11-01"); put("segmenter", "whole_shift"); put("total_m", 5_000); put("active_m", 5_000); put("deadhead_m", 0)
            put("personal_m", 0); put("calc_version", 4); put("updated_at", 100); put("recon_status", "match")
        } + over.toMap(),
    )

    private fun tripData(vararg over: Pair<String, JsonElement>): JsonObject = JsonObject(
        buildJsonObject {
            put("id", 8); put("shift_id", 5); put("trip_key", "$ID:1000:active"); put("kind", "active"); put("original_kind", "active")
            put("source", "auto"); put("started_at", 1_000); put("ended_at", 9_000); put("distance_m", 5_000); put("purpose", "")
        } + over.toMap(),
    )

    private fun FakeMileWage.change(entity: String, op: String, key: String, data: JsonObject? = null) {
        changes += buildJsonObject {
            put("seq", changes.size + 1); put("entity", entity); put("op", op); put("key", key); put("data", data ?: JsonNull)
        }
    }

    /** A paired phone with one ended shift that was sent (server id 5). */
    private suspend fun sentPhone(srv: FakeMileWage): Phone {
        val p = Phone(srv)
        p.data.startShift(3)
        p.clock.t = 9_000
        p.data.endShift()
        p.data.sendNow()
        return p
    }

    @Test
    fun insertsWhatThePhoneHasNotSeenKeepsTheCursorAndStoresSettings() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        srv.change("vehicle", "upsert", "3", buildJsonObject { put("id", 3); put("name", "Civic"); put("kind", "car"); put("ownership", "rented") })
        srv.change("shift", "upsert", "aaaa", shiftData("client_id" to JsonPrimitive("aaaa"), "id" to JsonPrimitive(6), "deduction_cents" to JsonPrimitive(350)))
        srv.change("trip", "upsert", "aaaa:1:active", tripData("shift_id" to JsonPrimitive(6), "trip_key" to JsonPrimitive("aaaa:1:active")))
        srv.change("settings", "upsert", "settings", JsonObject(FakeMileWage.SETTINGS + ("region" to JsonPrimitive("ON"))))
        p.data.sendNow()
        val imported = p.data.store.shift("aaaa")!!
        assertEquals(6L, imported.serverId)
        assertEquals(SendState.SENT, imported.sendState)
        assertEquals(CalcSource.SERVER, imported.calcSource)
        assertEquals(350L, imported.serverDeductionCents)
        assertTrue(imported.serverDeductionKnown)
        assertEquals(listOf("aaaa:1:active"), p.data.store.trips("aaaa").map { it.tripKey })
        assertEquals("Civic", p.data.store.vehicles().single().name)
        assertEquals("ON", p.data.pairing.load()!!.settings!!.region)
        assertEquals("4", p.data.store.get(ChangePuller.CURSOR))
        val from = srv.calls.size
        p.data.sendNow()
        assertTrue(srv.calls.drop(from).any { it.path == "/sync/changes" })
        assertEquals("4", p.data.store.get(ChangePuller.CURSOR))
    }

    @Test
    fun aRecalculationReplacesTheNumberAndThePhoneFigureGoesToTheOverwriteLog() = runBlocking {
        val srv = server()
        val p = sentPhone(srv)
        val before = p.data.store.shift(ID)!!
        srv.change("shift", "upsert", ID, shiftData("total_m" to JsonPrimitive(4_900), "active_m" to JsonPrimitive(4_900), "deduction_cents" to JsonNull, "id" to JsonPrimitive(before.serverId!!)))
        // Pretend the phone had shown 5,000 m.
        p.data.store.upsertShift(before.copy(distances = app.milewage.core.shift.Distances(5_000, 5_000, 0, 0)))
        p.data.sendNow()
        val after = p.data.store.shift(ID)!!
        assertEquals(4_900, after.distances!!.totalM)
        assertTrue(after.serverDeductionKnown) // a null deduction from the server is known, not missing
        assertNull(after.serverDeductionCents)
        val diff = p.data.store.overwrites(ID).single()
        assertEquals(OverwriteReason.RECON_DIFF, diff.reason)
        p.data.markOverwriteSeen(diff.id)
        assertEquals(emptyList(), p.data.store.overwrites(ID))
    }

    @Test
    fun lastWriterWinsOnAPendingShiftEditOlderLosesAndIsLoggedNewerIsKeptTiesGoToTheServer() = runBlocking {
        for ((phoneAt, wins) in listOf(50L to false, 100L to false, 150L to true)) {
            val srv = server()
            val p = sentPhone(srv)
            p.net.down = true
            p.data.sender.outbox.enqueue(ShiftChange.Patch(ID, "phone", phoneAt))
            p.data.store.upsertShift(p.data.store.shift(ID)!!.copy(notes = "phone", updatedAt = phoneAt))
            p.net.down = false
            srv.overrides["PATCH /shifts/$ID"] = { srv.problem(503, "x", true) } // the edit stays queued
            srv.change("shift", "upsert", ID, shiftData("notes" to JsonPrimitive("web"), "updated_at" to JsonPrimitive(100), "id" to JsonPrimitive(p.data.store.shift(ID)!!.serverId!!)))
            p.data.sender.outbox.pending().forEach { _ -> }
            // Pull directly: the round would stop at the failing PATCH before reading the log.
            pull(p)
            assertEquals(if (wins) "phone" else "web", p.data.store.shift(ID)!!.notes)
            assertEquals(if (wins) 1 else 0, p.data.sender.outbox.pending().count { it.kind == ChangeType.SHIFT_PATCH })
            assertEquals(if (wins) emptyList() else listOf(OverwriteReason.SUPERSEDED_BY_SERVER), p.data.store.overwrites(ID).map { it.reason })
        }
    }

    private suspend fun pull(p: Phone) {
        ChangePuller(p.data.store, p.data.sender.outbox, { p.data.pairing.session() }, p.data.pairing.device, { p.data.pairing.storeSettings(it) }, p.clock)
            .pull(force = true)
    }

    @Test
    fun aQueuedTripEditOlderThanTheServerRowLosesAndIsLogged() = runBlocking {
        val srv = server()
        val p = sentPhone(srv)
        val key = "$ID:1000:active"
        srv.change("trip", "upsert", key, tripData())
        pull(p)
        p.data.sender.outbox.enqueue(ShiftChange.Override(key, TripKind.PERSONAL, "errand", 100))
        srv.change("trip", "upsert", key, tripData("purpose" to JsonPrimitive("web"), "edited_at" to JsonPrimitive(150)))
        pull(p)
        val t = p.data.store.trips(ID).single()
        assertEquals(TripKind.ACTIVE, t.kind)
        assertEquals("web", t.purpose)
        assertEquals(0, p.data.sender.outbox.pending().count { it.kind == ChangeType.TRIP_OVERRIDE })
        assertEquals(OverwriteReason.SUPERSEDED_BY_SERVER, p.data.store.overwrites(ID).single().reason)
    }

    @Test
    fun aShiftWhoseEndThePhoneHasNotSentIsNotOverwrittenByTheFeed() = runBlocking {
        val srv = server()
        val p = Phone(srv)
        p.net.down = true
        p.data.startShift(3)
        p.data.endShift()
        p.net.down = false
        srv.change("shift", "upsert", ID, shiftData("status" to JsonPrimitive("active"), "total_m" to JsonNull, "ended_at" to JsonNull))
        pull(p)
        val s = p.data.store.shift(ID)!!
        assertEquals(ShiftStatus.ENDED, s.status)
        assertEquals(5L, s.serverId)
        assertEquals(SendState.ON_PHONE_ONLY, s.sendState)
    }

    @Test
    fun aDeleteOnTheWebRemovesTheShiftAndUnsentEditsAreLoggedNeverSent() = runBlocking {
        val srv = server()
        val p = sentPhone(srv)
        p.data.sender.outbox.enqueue(ShiftChange.Patch(ID, "x", 5))
        srv.change("shift", "delete", ID)
        pull(p)
        assertNull(p.data.store.shift(ID))
        assertEquals(0, p.data.sender.outbox.counts().pending)
        assertEquals(emptyList(), p.data.fixStore.fixesFor(ID))
        // The log entry outlives the shift (it is the phone's record of what was lost).
        assertEquals(1, p.data.store.overwrites(ID).size)
        assertEquals(OverwriteReason.DELETED_ON_SERVER, p.data.store.overwrites(ID).single().reason)
    }

    @Test
    fun tripTombstonesRemoveTheTripOrphanedOverridesAreReportedNotDropped() = runBlocking {
        val srv = server()
        val p = sentPhone(srv)
        val key = "$ID:1000:active"
        srv.change("trip", "upsert", key, tripData())
        pull(p)
        assertEquals(1, p.data.store.trips(ID).size)
        srv.change("override", "orphaned_override", key, buildJsonObject { put("trip_key", key); put("kind", "personal"); put("purpose", "x"); put("edited_at", 9) })
        srv.change("trip", "delete", key)
        pull(p)
        assertEquals(emptyList(), p.data.store.trips(ID))
        val log = p.data.store.overwrites(ID).single()
        assertTrue(log.serverJson!!.contains("\"orphaned\":true"))
    }

    @Test
    fun cursorExpiredReadsTheWholeWindowAgainAndDeletesNothingByItself() = runBlocking {
        val srv = server()
        val p = sentPhone(srv)
        var n = 0
        srv.overrides["GET /sync/changes"] = {
            if (++n == 2) {
                srv.problem(410, "cursor_expired")
            } else {
                srv.ok(200, buildJsonObject { put("changes", kotlinx.serialization.json.JsonArray(emptyList())); put("next_cursor", 7); put("has_more", false) })
            }
        }
        pull(p)
        pull(p)
        val afters = srv.calls.filter { it.path == "/sync/changes" }.map { it.toString() }
        assertEquals(4, afters.size) // the round's own pull, ours, the 410, the window again
        assertNotNull(p.data.store.shift(ID))
        assertEquals("7", p.data.store.get(ChangePuller.CURSOR))
    }

    @Test
    fun skippedWhenTheSyncModuleIsOffAndWithinTheIntervalOfflineIsNotAnError() = runBlocking {
        val srv = server()
        val off = app.milewage.core.api.ApiJson.decodeFromJsonElement(
            app.milewage.core.api.Settings.serializer(),
            JsonObject(FakeMileWage.SETTINGS + ("modules" to buildJsonObject { put("sync", false); put("tracking", true) })),
        )
        val p = Phone(srv, settings = off)
        val puller = ChangePuller(p.data.store, p.data.sender.outbox, { p.data.pairing.session() }, p.data.pairing.device, {}, p.clock)
        assertEquals(app.milewage.core.sync.PullState.DISABLED, puller.pull(force = true).state)
        val on = Phone(srv)
        val p2 = ChangePuller(on.data.store, on.data.sender.outbox, { on.data.pairing.session() }, on.data.pairing.device, {}, on.clock)
        assertEquals(app.milewage.core.sync.PullState.OK, p2.pull().state)
        assertEquals(app.milewage.core.sync.PullState.SKIPPED, p2.pull().state)
        on.net.down = true
        assertEquals(app.milewage.core.sync.PullState.OFFLINE, p2.pull(force = true).state)
        on.net.down = false
        srv.overrides["GET /sync/changes"] = { srv.problem(401, "device_revoked") }
        assertEquals(app.milewage.core.sync.PullState.HALTED, p2.pull(force = true).state)
    }
}
