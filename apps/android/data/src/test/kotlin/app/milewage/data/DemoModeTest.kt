package app.milewage.data

import app.milewage.core.api.ApiException
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TransportFailure
import app.milewage.core.demo.Demo
import app.milewage.core.demo.DemoServer
import app.milewage.core.pairing.MemoryStore
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingDeps
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.StartResult
import app.milewage.data.support.FakeRecorder
import app.milewage.data.support.Phone
import app.milewage.data.support.TestClock
import app.milewage.data.support.TestDb
import app.milewage.data.sync.SendScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Demo mode on the real data layer ("Try it without a server"): the phone pairs with the demo
 * server in its own process, records and "sends" a shift there, and leaving (or connecting a real
 * server) deletes everything of the demo. The network is a transport that records every request:
 * in demo mode it must never see one.
 */
class DemoModeTest {
    /** The network: no answer, and every request it was asked for. */
    private class Network : HttpTransport {
        val calls = java.util.Collections.synchronizedList(ArrayList<String>())

        override suspend fun exchange(request: HttpRequest): HttpResponse {
            calls += "${request.method} ${request.url}"
            throw TransportFailure.NoAnswer()
        }
    }

    // 2026-11-13 18:00 UTC (13:00 in Toronto): the morning sample shift is over.
    private val clock = TestClock(1_794_592_800_000)
    private val network = Network()
    private var self: MileWageData? = null
    private val recorder = FakeRecorder()
    private var next = 0
    private val data: MileWageData = MileWageData.assemble(
        db = TestDb.open(),
        connect = { onAnswer, onSettings ->
            val transport = DemoServer.routing(DemoServer(clock) { id -> self?.store?.shift(id) }, network)
            Pairing(PairingDeps(MemoryStore(), MemoryStore(), transport, clock, "0.3.1", onAnswer = onAnswer, onSettings = onSettings))
        },
        recorder = recorder,
        scheduler = SendScheduler.None,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        clock = clock,
        appVersion = "0.3.1",
        newId = { "33333333-3333-4333-8333-${(next++).toString().padStart(12, '0')}" },
        rand = { 0.5 },
    ).also { self = it }

    @Test
    fun enteringPairsWithTheDemoAndShowsSampleShiftsAndARunningTotalWithoutTheNetwork() = runBlocking {
        assertFalse(data.isDemo())
        data.enterDemo()

        assertTrue(data.isDemo())
        assertEquals(PairingStatus.PAIRED, data.pairing.status())
        assertTrue(data.pairing.setupPending(), "the setup steps follow, as after any first connection")
        val settings = data.pairing.load()!!.settings!!
        assertEquals("CA", settings.country)
        assertEquals("CAD", settings.currency)
        assertEquals(app.milewage.core.api.DistanceUnit.KM, settings.distanceUnit)

        assertEquals(Demo.VEHICLE_IDS, data.refreshVehicles().vehicles.map { it.id }.toSet())
        val shifts = data.store.shifts(500)
        assertTrue(shifts.size >= 10, "a few weeks of sample shifts: ${shifts.size}")
        assertTrue(shifts.all { it.instanceId == Demo.INSTANCE && it.sendState == SendState.SENT && it.status == ShiftStatus.ENDED })
        val one = shifts.first()
        assertTrue(data.store.trips(one.clientId).isNotEmpty())
        assertTrue(data.store.stops(one.clientId).isNotEmpty())
        assertTrue(data.store.route(one.clientId).size > 2)
        assertEquals(one.distances!!.totalM, data.store.trips(one.clientId).sumOf { it.distanceM })

        val summary = data.summaryNow()
        assertTrue(summary.month.totalM > 0)
        assertTrue((summary.week.deductionCents ?: 0) > 0, "Home shows a deduction value at the demo's rate")
        assertTrue(data.sendNow(), "nothing waits")
        assertEquals(emptyList(), network.calls)
    }

    @Test
    fun aShiftRecordedInTheDemoEndsAndIsAnsweredInProcessNeverOverTheNetwork() = runBlocking {
        data.enterDemo()
        data.pairing.finishSetup()
        clock.t += 60_000
        val started = data.startShift(Demo.VEHICLES.first().id)
        assertIs<StartResult.Started>(started)
        assertEquals(started.shift.clientId, recorder.recordingId, "the tracker records for real")
        data.fixStore.append(started.shift.clientId, Phone.drive(clock.t, 60, startLat = 436_500_000))
        clock.t += 700_000
        data.endShift()
        assertTrue(data.sendNow())

        val shift = data.store.shift(started.shift.clientId)!!
        assertEquals(SendState.SENT, shift.sendState)
        assertEquals(ReconStatus.MATCH, shift.recon, "the demo agrees with the phone: no Difference")
        assertEquals(Demo.INSTANCE, shift.instanceId)
        assertEquals(emptyList(), network.calls)
    }

    @Test
    fun leavingEndsTheDemoShiftDeletesTheDemosDataAndKeepsEverythingElse() = runBlocking {
        // A shift of another server, never sent there: the demo must not touch it.
        val other = ShiftRecord(
            clientId = Phone.B, vehicleId = 3, status = ShiftStatus.ENDED, segmenter = Segmenter.STOPS,
            startedAt = 1_000, endedAt = 2_000, localDate = "2026-11-01", updatedAt = 2_000, instanceId = "inst-A",
        )
        data.store.upsertShift(other)
        data.enterDemo()
        clock.t += 60_000
        val started = data.startShift(Demo.VEHICLES.first().id) as StartResult.Started

        assertTrue(data.leaveDemo())

        assertNull(recorder.recordingId, "the demo shift ended and the tracker stopped")
        assertFalse(data.isDemo())
        assertEquals(PairingStatus.UNPAIRED, data.pairing.status())
        assertNull(data.store.shift(started.shift.clientId))
        assertEquals(listOf(Phone.B), data.store.shifts(500).map { it.clientId })
        assertTrue(data.store.vehicles().none { it.id in Demo.VEHICLE_IDS })
        assertNull(data.store.get(Demo.KEY_SINCE))
        assertFalse(data.leaveDemo(), "not in demo mode any more")
        assertEquals(emptyList(), network.calls)
    }

    @Test
    fun connectingARealServerFromTheDemoDeletesTheDemoFirst() = runBlocking {
        data.enterDemo()
        val link = PairingLink("https://mw.example.com", "mwp_" + "a".repeat(43))

        // The real server cannot be reached here; the demo is gone before the code is even tried.
        assertFailsWith<ApiException> { data.connect(link) }

        assertFalse(data.isDemo())
        assertEquals(emptyList(), data.store.shifts(500))
        assertEquals(listOf("POST https://mw.example.com/api/v1/pairing/redeem"), network.calls)
    }
}
