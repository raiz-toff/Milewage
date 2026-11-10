package app.milewage.core.sync

import app.milewage.core.api.Segmenter
import app.milewage.core.diagnostics.PhoneDiagnostics
import app.milewage.core.pairing.Credential
import app.milewage.core.pairing.HaltReason
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The server binding's rules (the store-backed half is tested in :data against two servers). */
class ServerBindingTest {
    private fun shift(
        id: String,
        instance: String?,
        send: SendState = SendState.ON_PHONE_ONLY,
        status: ShiftStatus = ShiftStatus.ENDED,
        startedAt: Long = 1_000,
    ) = ShiftRecord(
        clientId = id, vehicleId = 3, status = status, segmenter = Segmenter.STOPS, startedAt = startedAt, endedAt = 9_000,
        localDate = "2026-11-01", updatedAt = 1, sendState = send, instanceId = instance,
    )

    @Test
    fun aShiftIsBoundOnlyToItsOwnServer() {
        assertTrue(ServerBinding.boundTo("inst-A", "inst-A"))
        assertFalse(ServerBinding.boundTo("inst-A", "inst-B"))
        // Unbound rows are no server's until one claims them; a server without an id matches only them.
        assertFalse(ServerBinding.boundTo(null, "inst-A"))
        assertFalse(ServerBinding.boundTo("inst-A", null))
        assertTrue(ServerBinding.boundTo(null, null))
    }

    @Test
    fun waitingElsewhereMeansAnotherServersEndedShiftNotYetSent() {
        assertTrue(ServerBinding.waitsElsewhere(shift("a", "inst-A"), "inst-B"))
        assertTrue(ServerBinding.waitsElsewhere(shift("a", "inst-A", SendState.NEEDS_ATTENTION), "inst-B"))
        assertFalse(ServerBinding.waitsElsewhere(shift("a", "inst-A", SendState.SENT), "inst-B")) // history, on its server
        assertFalse(ServerBinding.waitsElsewhere(shift("a", "inst-A", status = ShiftStatus.RUNNING), "inst-B")) // still recording
        assertFalse(ServerBinding.waitsElsewhere(shift("a", "inst-B"), "inst-B"))
    }

    @Test
    fun theMarkerSaysRecordedForAnotherServerOnlyWhileItWaits() {
        assertEquals(ShiftMarker.OTHER_SERVER, ShiftMarker.of(shift("a", "inst-A"), "inst-B"))
        assertEquals(ShiftMarker.OTHER_SERVER, ShiftMarker.of(shift("a", "inst-A", status = ShiftStatus.RUNNING), "inst-B"))
        assertEquals(ShiftMarker.SENT, ShiftMarker.of(shift("a", "inst-A", SendState.SENT), "inst-B"))
        assertEquals(ShiftMarker.ON_PHONE_ONLY, ShiftMarker.of(shift("a", "inst-B"), "inst-B"))
        assertEquals(ShiftMarker.NEEDS_ATTENTION, ShiftMarker.of(shift("a", "inst-B", SendState.NEEDS_ATTENTION), "inst-B"))
    }

    @Test
    fun theSummaryCountsAnotherServersShiftsTheirFixesAndHostNames() {
        val unsent = listOf(
            shift("a", "inst-A", startedAt = 5_000),
            shift("b", "inst-A", startedAt = 2_000),
            shift("c", "inst-C", startedAt = 9_000),
            shift("d", "inst-B"),
            shift("e", "inst-A", status = ShiftStatus.RUNNING),
        )
        val s = OtherServerShifts.of(unsent, mapOf("a" to 10L, "b" to 5L, "d" to 99L), "inst-B", mapOf("inst-A" to "old.example.ts.net"))
        assertEquals(3, s.shifts)
        assertEquals(15L, s.fixes)
        assertEquals(listOf("old.example.ts.net"), s.hosts) // inst-C's name was never known
        assertEquals(2_000L, s.oldestAt)
        assertTrue(OtherServerShifts.of(listOf(shift("d", "inst-B")), emptyMap(), "inst-B", emptyMap()).none)
    }

    @Test
    fun theChangeLogCursorThePullTimeAndTheRestoreGenerationArePerServer() {
        assertEquals("sync.cursor@inst-A", ServerBinding.keyFor(ChangePuller.CURSOR, "inst-A"))
        assertEquals("sync.lastPullAt@inst-A", ServerBinding.keyFor(ChangePuller.LAST_PULL, "inst-A"))
        assertEquals("sync.restoreGen@inst-B", ServerBinding.keyFor(RestoreCheck.KEY, "inst-B"))
        assertEquals("sync.cursor", ServerBinding.keyFor(ChangePuller.CURSOR, null))
        // The phone's own values stay shared.
        assertEquals("shift.lastVehicle", ServerBinding.keyFor("shift.lastVehicle", "inst-A"))
        assertEquals("reminder.pending", ServerBinding.keyFor(UnsyncedReminders.SAVED_KEY, "inst-A"))
    }

    @Test
    fun theServerIsNamedByItsAwayHostThenItsHomeHost() {
        assertEquals("box.tail1.ts.net", ServerBinding.hostOf(Credential("http://192.168.1.20:8080", "http://192.168.1.20:8080", "https://box.tail1.ts.net", 1, "mwd_x", "i")))
        assertEquals("192.168.1.20", ServerBinding.hostOf(Credential("http://192.168.1.20:8080", "http://192.168.1.20:8080", null, 1, "mwd_x", "i")))
    }

    @Test
    fun syncStateNamesTheHaltThenTheRestoreThenTheLastRound() {
        assertEquals("revoked", PhoneDiagnostics.syncStateOf(HaltReason.REPAIR, true, Round.State.IDLE))
        assertEquals("wrong_instance", PhoneDiagnostics.syncStateOf(HaltReason.WRONG_SERVER, false, Round.State.HALTED))
        assertEquals("unauthorized", PhoneDiagnostics.syncStateOf(HaltReason.AUTH_PROBLEM, false, Round.State.HALTED))
        assertEquals("restored", PhoneDiagnostics.syncStateOf(null, true, Round.State.IDLE))
        assertEquals("unreachable", PhoneDiagnostics.syncStateOf(null, false, Round.State.OFFLINE))
        assertEquals("reachable", PhoneDiagnostics.syncStateOf(null, false, Round.State.IDLE))
        assertNull(PhoneDiagnostics.syncStateOf(null, false, Round.State.NOT_PAIRED))
        assertNull(PhoneDiagnostics.syncStateOf(null, false, null))
    }

    @Test
    fun freeSpaceBucketsAreTheCataloguesOwn() {
        val mb = 1024L * 1024
        assertEquals(listOf("lt20", "lt50", "lt200", "lt1000", "ge1000"), listOf(5, 20, 199, 999, 1000).map { PhoneDiagnostics.freeBucket(it * mb) })
    }
}
