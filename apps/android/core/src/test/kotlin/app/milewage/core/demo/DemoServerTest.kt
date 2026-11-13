package app.milewage.core.demo

import app.milewage.core.api.Api
import app.milewage.core.api.ApiClient
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.ManualTripPut
import app.milewage.core.api.OdometerPut
import app.milewage.core.api.PhoneResult
import app.milewage.core.api.Segmenter
import app.milewage.core.api.ShiftEnd
import app.milewage.core.api.ShiftPatch
import app.milewage.core.api.ShiftStart
import app.milewage.core.api.ShiftStatus
import app.milewage.core.api.TelemetryBatch
import app.milewage.core.api.TelemetryPoint
import app.milewage.core.api.TransportFailure
import app.milewage.core.api.TripKind
import app.milewage.core.api.TripOverridePut
import app.milewage.core.pairing.MemoryStore
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingDeps
import app.milewage.core.ports.Clock
import app.milewage.core.shift.SendState
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The demo's in-process server answers the whole contract, and its address never reaches the network. */
class DemoServerTest {
    // 2026-11-13 18:00 UTC.
    private val clock = Clock { 1_794_592_800_000 }

    private val network = object : HttpTransport {
        val calls = ArrayList<String>()

        override suspend fun exchange(request: HttpRequest): HttpResponse {
            calls += request.url
            throw TransportFailure.NoAnswer()
        }
    }

    private val transport = DemoServer.routing(DemoServer(clock), network)

    @Test
    fun pairingWithTheDemoStoresItsCredentialAndCanadianSettings() = runBlocking {
        val pairing = Pairing(PairingDeps(MemoryStore(), MemoryStore(), transport, clock, "0.3.1"))
        val state = pairing.redeem(Demo.LINK)
        assertTrue(Demo.isDemo(state.credential))
        assertEquals(Demo.INSTANCE, state.credential.instanceId)
        assertEquals("CA", state.settings?.country)
        assertEquals("CAD", state.settings?.currency)
        assertEquals(false, state.settings?.helpEnabled, "no Help links to a server that does not exist")
        assertEquals(Demo.VEHICLE_IDS, pairing.session()!!.client.call(Api.vehicles).data.map { it.id }.toSet())
        assertEquals(emptyList(), network.calls)
    }

    @Test
    fun everyOperationThePhoneCallsIsAnswered() = runBlocking {
        val c = ApiClient(transport, { Demo.BASE_URL }, clock, token = DemoServer.TOKEN)
        val id = "44444444-4444-4444-8444-444444444444"
        val ref = mapOf("ref" to id)
        assertTrue(c.call(Api.health).data.ok)
        assertEquals("CA", c.call(Api.settings).data.country)
        assertEquals(7, c.call(Api.pullChanges, query = listOf("after" to "7")).data.nextCursor)
        val created = c.call(Api.startShift, ShiftStart(id, 900_001, clock.nowMs()))
        assertEquals(201, created.status)
        assertEquals(ShiftStatus.ACTIVE, created.data.status)
        assertEquals("2026-11-13", created.data.localDate)
        val point = TelemetryPoint(1, clock.nowMs(), 436_500_000, -793_800_000, 5, null, null, null)
        assertEquals(1, c.call(Api.uploadPoints, TelemetryBatch(id, listOf(point))).data.inserted)
        c.call(Api.updateShift, ShiftPatch(notes = "x"), ref)
        c.call(Api.setOdometer, OdometerPut(1_000_000, clock.nowMs()), mapOf("ref" to id, "kind" to "shift_start"))
        c.call(Api.putTripOverride, TripOverridePut(TripKind.PERSONAL, "Lunch", clock.nowMs()), mapOf("ref" to id, "trip_key" to "k1"))
        c.call(Api.putManualTrip, ManualTripPut(TripKind.ACTIVE, 1, 2, 3_000, "", 3), mapOf("ref" to id, "client_id" to "m1"))
        val phone = PhoneResult(5, Segmenter.STOPS, "0123456789abcdef", 12_000, 8_000, 4_000, 0, tripsCount = 2)
        val end = c.call(Api.endShift, ShiftEnd(clock.nowMs() + 1, phoneResult = phone), ref).data
        assertEquals(12_000, end.shift.totalM)
        assertEquals("match", end.recon?.status)
        assertEquals(emptyList(), network.calls)
    }

    @Test
    fun otherAddressesGoToTheNetworkAndTheDemoAddressNever() = runBlocking {
        assertFailsWith<TransportFailure.NoAnswer> { transport.exchange(HttpRequest(app.milewage.core.api.HttpMethod.GET, "https://mw.example.com/healthz")) }
        assertEquals(listOf("https://mw.example.com/healthz"), network.calls)
        // A host that only starts like the demo's is not the demo.
        assertFailsWith<TransportFailure.NoAnswer> { transport.exchange(HttpRequest(app.milewage.core.api.HttpMethod.GET, Demo.BASE_URL + ".evil.com/healthz")) }
        assertEquals(2, network.calls.size)
    }

    @Test
    fun theSamplesAreThreeWeeksOfSentShiftsWhoseTotalsAreTheirTrips() {
        val samples = DemoSamples.of(clock.nowMs())
        assertEquals(samples, DemoSamples.of(clock.nowMs()), "the same day gives the same samples")
        assertTrue(samples.size in 12..17, "${samples.size}")
        assertEquals("${Demo.SAMPLE_PREFIX}2026-11-13", samples.first().shift.clientId, "a morning shift today once it is over")
        for (s in samples) {
            assertTrue(s.shift.clientId.startsWith(Demo.SAMPLE_PREFIX))
            assertEquals(Demo.INSTANCE, s.shift.instanceId)
            assertEquals(SendState.SENT, s.shift.sendState)
            assertEquals(s.trips.sumOf { it.distanceM }, s.shift.distances!!.totalM)
            assertEquals(s.trips.size, s.stops.size)
            assertTrue(s.shift.endedAt!! > s.shift.startedAt)
            assertTrue(s.trips.all { it.startedAt >= s.shift.startedAt && it.endedAt <= s.shift.endedAt })
        }
        assertTrue(samples.any { s -> s.trips.any { it.kind == TripKind.PERSONAL } })
        assertTrue(samples.map { it.shift.vehicleId }.toSet() == Demo.VEHICLE_IDS, "both vehicles are used")
    }
}
