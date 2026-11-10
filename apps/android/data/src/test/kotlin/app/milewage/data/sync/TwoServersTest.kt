package app.milewage.data.sync

import app.milewage.core.net.HomeAddress
import app.milewage.core.pairing.HaltReason
import app.milewage.core.pairing.PairingLink
import app.milewage.core.shift.SendState
import app.milewage.core.sync.ChangePuller
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.Phone.Companion.B
import app.milewage.data.support.Phone.Companion.ID
import app.milewage.data.support.Phone.Companion.drive
import app.milewage.data.support.Phone.Companion.sid
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Two MileWage servers, each a MockWebServer with its own instance id: a shift recorded for one is
 * only ever sent to that one. The evidence is what each server received.
 */
class TwoServersTest {
    private val servers = ArrayList<FakeMileWage>()

    private fun server(instance: String) = FakeMileWage(instance).start().also(servers::add)

    @After
    fun close() = servers.forEach { it.close() }

    /** Every request [srv] received (from [from]) that names the shift [id], in its path or its body. */
    private fun naming(srv: FakeMileWage, id: String, from: Int = 0): List<String> =
        synchronized(srv.calls) { srv.calls.drop(from).filter { id in it.path || id in it.body.toString() }.map { it.toString() } }

    private fun link(srv: FakeMileWage, c: Char) = PairingLink(srv.url, "mwp_" + c.toString().repeat(43))

    /** A shift recorded and ended on [p] with no connection: create, [fixes] fixes and end wait on the phone. */
    private suspend fun recordOffline(p: Phone, at: Long, fixes: Int = 5) {
        p.net.down = true
        p.clock.t = at
        p.data.startShift(3)
        if (fixes > 0) p.record(drive(at, fixes))
        p.clock.t = at + 100_000
        p.data.endShift()
        p.net.down = false
    }

    private suspend fun marker(p: Phone, id: String) = p.data.shiftList().first().single { it.shift.clientId == id }.marker

    @Test
    fun aShiftRecordedForOneServerNeverReachesAnotherAndGoesWhenItsServerIsPairedAgain() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        val p = Phone(a, ids = listOf(ID, B))
        recordOffline(p, 1_000)
        assertEquals("inst-A", p.data.store.shift(ID)!!.instanceId)

        // "Connect to a different server": the phone asks first (data waits), the driver confirms. Nothing is deleted.
        assertFalse(p.data.unpair())
        assertTrue(p.data.unpair(confirmed = true))
        assertNotNull(p.data.store.shift(ID))
        p.pair(to = b)

        // A shift recorded for B goes to B, and B's queue is not held up by A's shift.
        recordOffline(p, 500_000, fixes = 3)
        assertEquals("inst-B", p.data.store.shift(B)!!.instanceId)
        assertTrue(p.data.sendNow()) // nothing left for B
        assertEquals(listOf("POST /shifts", "POST /telemetry/batch", "POST /shifts/$B/end"), b.writes())
        assertEquals(emptyList(), naming(b, ID))
        assertEquals(emptyList(), naming(a, B))

        // What the driver sees: B is all sent; A's shift is marked, counted apart, with A's host name.
        val status = p.data.sender.status().sync
        assertEquals(0, status.unsentShifts)
        assertEquals(StatusColor.GREEN, status.color)
        assertFalse(p.data.hasUnsentData())
        assertEquals(ShiftMarker.OTHER_SERVER, marker(p, ID))
        assertEquals(ShiftMarker.SENT, marker(p, B))
        assertEquals(ShiftMarker.OTHER_SERVER, p.data.detailNow(ID)!!.marker)
        val other = p.data.otherServerNow()
        assertEquals(1, other.shifts)
        assertEquals(5L, other.fixes)
        assertEquals(listOf(HomeAddress.parts(a.url)!!.host), other.hosts)
        assertEquals(1_000L, other.oldestAt)

        // Back to A: nothing waits for B, so no question; A's shift goes to A as recorded.
        assertTrue(p.data.unpair())
        p.pair(to = a)
        val fromA = a.calls.size
        val fromB = b.calls.size
        assertTrue(p.data.sendNow())
        assertEquals(listOf("POST /shifts", "POST /telemetry/batch", "POST /shifts/$ID/end"), a.writes(fromA))
        assertEquals(5, a.state.points[ID]!!.size)
        assertEquals(fromB, b.calls.size)
        assertEquals(SendState.SENT, p.data.store.shift(ID)!!.sendState)
        assertTrue(p.data.otherServerNow().none)
        assertEquals(emptyList(), naming(a, B))
    }

    @Test
    fun anotherServersQueueDoesNotHoldUpTheRunningShiftOrTheCounts() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        val p = Phone(a, ids = listOf(ID, B))
        recordOffline(p, 1_000) // A's create and end are queued: on one server they would hold the next create back
        assertTrue(p.data.unpair(confirmed = true))
        p.pair(to = b)
        p.clock.t = 500_000
        p.data.startShift(3)
        p.record(drive(500_000, 4))
        p.data.sendNow()
        assertEquals(listOf("POST /shifts", "POST /telemetry/batch"), b.writes())
        assertEquals(emptyList(), naming(b, ID))
        val s = p.data.sender.status().sync
        assertEquals(1, s.unsentShifts) // the running one only
        assertEquals(0L, s.unsentFixes)
        assertNull(s.message)
        assertEquals(1, p.data.otherServerNow().shifts)
    }

    @Test
    fun afterTheDifferentServerBannerRePairingSendsOnlyTheNewServersShifts() = runBlocking {
        val srv = server("inst-A")
        val p = Phone(srv, ids = listOf(ID, B))
        recordOffline(p, 1_000)
        // The address now answers as another MileWage server (reinstalled): halted before anything leaves.
        srv.instance = "inst-B"
        assertFalse(p.data.sendNow())
        assertEquals(HaltReason.WRONG_SERVER, p.data.sender.status().sync.halt)
        assertEquals(StatusMessage.WRONG_SERVER, p.data.sender.status().sync.message)
        assertEquals(emptyList(), srv.writes())

        // The driver pairs with the server now at that address (AR3: sending resumes at once).
        p.data.pairing.redeem(link(srv, 'a'))
        assertEquals("inst-B", p.data.pairing.load()!!.credential.instanceId)
        assertNull(p.data.pairing.device.halted())
        val from = srv.calls.size
        assertTrue(p.data.sendNow()) // nothing for this server: done
        assertEquals(emptyList(), srv.writes(from))
        recordOffline(p, 500_000, fixes = 0)
        assertTrue(p.data.sendNow())
        assertEquals(listOf("POST /shifts", "POST /shifts/$B/end"), srv.writes(from))
        assertEquals(emptyList(), naming(srv, ID))
        assertEquals(ShiftMarker.OTHER_SERVER, marker(p, ID))
        assertEquals("inst-A", p.data.store.shift(ID)!!.instanceId)
    }

    @Test
    fun revokedThenPairedWithADifferentServerTheOldShiftsStayForTheOldServer() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        a.overrides["POST /shifts"] = { a.problem(401, "device_revoked") }
        val p = Phone(a, ids = listOf(ID, B))
        recordOffline(p, 1_000)
        assertFalse(p.data.sendNow())
        assertEquals(HaltReason.REPAIR, p.data.sender.status().sync.halt)
        p.data.pairing.redeem(link(b, 'b'))
        assertNull(p.data.pairing.device.halted())
        assertTrue(p.data.sendNow())
        assertEquals(listOf("POST /pairing/redeem"), b.writes())
        assertEquals(emptyList(), naming(b, ID))
        assertEquals(1, p.data.otherServerNow().shifts)
    }

    @Test
    fun aShiftRunningWhenThePairingChangesKeepsItsServer() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        val p = Phone(a, ids = listOf(ID, B))
        p.data.startShift(3)
        p.record(drive(1_000, 3))
        p.data.sendNow()
        assertEquals(listOf("POST /shifts", "POST /telemetry/batch"), a.writes())
        // Removed on A mid-shift; the driver connects to B while the shift records on.
        a.overrides["POST /telemetry/batch"] = { a.problem(401, "device_revoked") }
        p.record(drive(40_000, 3))
        assertFalse(p.data.sendNow())
        p.data.pairing.redeem(link(b, 'c'))
        p.record(drive(80_000, 3))
        p.data.sendNow()
        assertEquals(ShiftMarker.OTHER_SERVER, p.data.detailNow(ID)!!.marker)
        assertEquals(0, p.data.sender.status().sync.unsentShifts)
        p.clock.t = 200_000
        p.data.endShift()
        p.data.sendNow()
        assertEquals(listOf("POST /pairing/redeem"), b.writes())
        assertEquals(emptyList(), naming(b, ID))
        assertEquals(1, p.data.otherServerNow().shifts)

        // Paired with A again: the rest of it goes there, end included.
        a.overrides.clear()
        assertTrue(p.data.unpair())
        p.pair(to = a)
        val from = a.calls.size
        assertTrue(p.data.sendNow())
        assertEquals(listOf("POST /telemetry/batch", "POST /shifts/$ID/end"), a.writes(from))
        assertEquals(9, a.state.points[ID]!!.size)
    }

    @Test
    fun deletingTakesOnlyAnotherServersUnsentShiftsWithEverythingOfThem() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        val sent = sid(1)
        val p = Phone(a, ids = listOf(sent, ID, B))
        p.data.startShift(3)
        p.clock.t = 50_000
        p.data.endShift()
        assertTrue(p.data.sendNow())
        recordOffline(p, 100_000)
        assertTrue(p.data.unpair(confirmed = true))
        assertEquals(0, p.data.deleteOtherServerShifts()) // not paired: nothing to compare with
        p.pair(to = b)
        recordOffline(p, 500_000, fixes = 2)
        p.net.down = true

        assertEquals(1, p.data.deleteOtherServerShifts())
        assertNull(p.data.store.shift(ID))
        assertEquals(emptyList(), p.data.store.fixes.fixesFor(ID))
        assertTrue(p.data.store.pendingChanges().none { it.shiftClientId == ID })
        assertTrue(p.data.otherServerNow().none)
        // A's sent shift stays (it is history, on A); B's shift and its queue are untouched.
        assertEquals(SendState.SENT, p.data.store.shift(sent)!!.sendState)
        assertEquals(2, p.data.store.fixes.fixesFor(B).size)
        assertEquals(2, p.data.store.pendingChanges().count { it.shiftClientId == B })
        p.net.down = false
        assertTrue(p.data.sendNow())
        assertEquals(emptyList(), naming(b, ID))
    }

    @Test
    fun eachServersChangeLogAndRestoreGenerationAreItsOwn() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        repeat(3) { i ->
            a.changes += buildJsonObject { put("seq", i + 1); put("entity", "vehicle"); put("op", "upsert"); put("key", "3"); put("data", buildJsonObject { put("id", 3); put("name", "Civic"); put("kind", "car") }) }
        }
        b.changes += buildJsonObject { put("seq", 1); put("entity", "vehicle"); put("op", "upsert"); put("key", "9"); put("data", buildJsonObject { put("id", 9); put("name", "Van"); put("kind", "car") }) }
        // B was restored from a backup long ago: a high generation of its own, which says nothing about A.
        b.gen = 40
        val p = Phone(a)
        assertTrue(p.data.sendNow())
        assertEquals("3", p.data.store.get("${ChangePuller.CURSOR}@inst-A"))
        assertTrue(p.data.unpair())
        p.pair(to = b)
        assertTrue(p.data.sendNow())
        // B's first change (seq 1) is read: A's cursor (3) does not skip it.
        assertTrue(p.data.store.vehicles().any { it.name == "Van" })
        assertEquals("1", p.data.store.get("${ChangePuller.CURSOR}@inst-B"))
        assertEquals("40", p.data.store.get("sync.restoreGen@inst-B"))
        assertEquals("1", p.data.store.get("sync.restoreGen@inst-A"))
        assertNull(p.data.sender.status().sync.message) // not "restored": each server counts its own
    }

    @Test
    fun anotherServersChangeLogCannotTouchThisServersShifts() = runBlocking {
        val a = server("inst-A")
        val b = server("inst-B")
        val p = Phone(a)
        recordOffline(p, 1_000)
        assertTrue(p.data.unpair(confirmed = true))
        // A server that somehow names A's shift (a copy of A's database) deletes it in its change log.
        b.changes += buildJsonObject { put("seq", 1); put("entity", "shift"); put("op", "delete"); put("key", ID); put("data", JsonNull) }
        p.pair(to = b)
        assertTrue(p.data.sendNow())
        assertNotNull(p.data.store.shift(ID))
        assertEquals(2, p.data.store.pendingChanges().count { it.shiftClientId == ID })
        assertEquals(emptyList(), b.writes())
    }
}
