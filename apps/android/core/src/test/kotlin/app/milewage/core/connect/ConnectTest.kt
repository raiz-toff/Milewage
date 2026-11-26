package app.milewage.core.connect

import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.TransportFailure
import app.milewage.core.support.AWAY
import app.milewage.core.support.HOME
import app.milewage.core.support.TestClock
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** connect.test.ts (address checks), homeaway.test.ts and awayhints.test.tsx (the picker). */
class ConnectTest {
    // ---- network state (net-check's LocalNetworkTest and VpnStateTest)

    @Test
    fun wifiAndEthernetAreLocalAlsoUnderAVpnMobileDataIsNot() {
        assertEquals(true, NetState.localNetwork(setOf(NetTransport.WIFI)))
        assertEquals(true, NetState.localNetwork(setOf(NetTransport.ETHERNET)))
        assertEquals(true, NetState.localNetwork(setOf(NetTransport.WIFI, NetTransport.VPN)))
        assertEquals(false, NetState.localNetwork(setOf(NetTransport.CELLULAR, NetTransport.VPN)))
        assertNull(NetState.localNetwork(null))
    }

    @Test
    fun onlyTheVpnTransportSaysAVpnIsOn() {
        assertEquals(true, NetState.vpnActive(setOf(NetTransport.WIFI, NetTransport.VPN)))
        assertEquals(false, NetState.vpnActive(setOf(NetTransport.WIFI)))
        assertNull(NetState.vpnActive(null))
    }

    // ---- address checks and messages (plan 19 section 3.5)

    @Test
    fun knowsATailnetAddress() {
        assertTrue(Reach.isTailnetAddress(AWAY))
        assertTrue(Reach.isTailnetAddress("https://box.tail1234.ts.net:8443"))
        assertFalse(Reach.isTailnetAddress("https://ts.net.example.com"))
    }

    @Test
    fun refusesThisComputerAlwaysAndHttpOutsideTheHomeNetworkInARelease() {
        for (u in listOf("http://localhost:5173", "https://127.0.0.1", "http://[::1]:8080")) {
            assertEquals(AddressProblem.THIS_COMPUTER, Reach.addressProblem(u, false), u)
        }
        assertEquals(AddressProblem.INSECURE_OUTSIDE_HOME, Reach.addressProblem("http://box.example.com:8080", true))
        assertNull(Reach.addressProblem("http://box.example.com:8080", false)) // debug build
        assertNull(Reach.addressProblem("http://192.168.1.20:8080", true))
        assertNull(Reach.addressProblem("http://milewage.local", true))
        assertNull(Reach.addressProblem(AWAY, true))
    }

    @Test
    fun saysWhichStepIsWrongWhenConnectingFails() {
        assertEquals(ConnectFailure.TailscaleOff, Reach.explainFailure("network", AWAY, false))
        assertTrue(ConnectFailure.TailscaleOff.offerTailscale)
        assertEquals(ConnectFailure.TailnetNotAnswering, Reach.explainFailure("network", AWAY, true))
        assertEquals(ConnectFailure.TailscaleUnknown, Reach.explainFailure("network", AWAY, null))
        assertEquals(ConnectFailure.Unreachable, Reach.explainFailure("network", "https://mw.example.net", false))
        assertEquals(ConnectFailure.NotMileWage, Reach.explainFailure("not_milewage", AWAY, null))
        assertEquals(ConnectFailure.InvalidCode, Reach.explainFailure("invalid_pairing_token", AWAY, null))
        assertEquals(ConnectFailure.Other, Reach.explainFailure("something_new", AWAY, null))
    }

    @Test
    fun atHomeThereIsNoTailscaleToBlame() {
        assertEquals(ConnectFailure.HomeUnreachable(HOME), Reach.explainFailure("network", HOME, false))
    }

    // ---- home or away (plan 28 section 4.3)

    private val both = Addresses(baseUrl = AWAY, homeUrl = HOME, awayUrl = AWAY, instanceId = "inst-1")

    private class Picker(local: Boolean?, answers: Boolean = true) {
        val probes = mutableListOf<String>()
        val clock = TestClock(0)
        val r = RoutePicker(
            localNetwork = { local },
            probe = { url, _ -> probes += url; answers },
            clock = clock,
        )
    }

    @Test
    fun oneAddressThatOneWithoutLooking() = runTest {
        val p = Picker(true)
        assertEquals(Picked(AWAY, Where.AWAY), p.r.pick(Addresses(AWAY)))
        assertEquals(Picked(HOME, Where.HOME), p.r.pick(Addresses(HOME)))
        assertEquals(emptyList(), p.probes)
    }

    @Test
    fun aPhoneFromBeforePlan28ReadsItsOneAddressAsHomeOrAway() {
        assertEquals(HOME to null, Addresses(HOME).homeAndAway())
        assertEquals(null to AWAY, Addresses(AWAY).homeAndAway())
    }

    @Test
    fun onWifiAndTheHomeAddressAnswersHomeOnMobileDataAwayWithoutTrying() = runTest {
        assertEquals(Picked(HOME, Where.HOME), Picker(true).r.pick(both))
        val mobile = Picker(false)
        assertEquals(Picked(AWAY, Where.AWAY), mobile.r.pick(both))
        assertEquals(emptyList(), mobile.probes)
        assertEquals(Where.HOME, Picker(null).r.pick(both).where) // cannot tell: try
        assertEquals(Picked(AWAY, Where.AWAY), Picker(true, answers = false).r.pick(both))
    }

    @Test
    fun remembersForAMinuteAndLooksAgainAfterARequestGotNoAnswer() = runTest {
        val p = Picker(true)
        p.r.pick(both)
        p.clock.now = RouteTimes.REMEMBER_MS - 1
        p.r.pick(both)
        assertEquals(1, p.probes.size)
        p.r.forget()
        p.r.pick(both)
        p.clock.now += RouteTimes.REMEMBER_MS
        p.r.pick(both)
        assertEquals(3, p.probes.size)
        assertEquals(Where.HOME, p.r.where)
    }

    // ---- the way home: a network change drops the choice, a failed probe gets quick retries

    /** A picker whose home probe answers from [answers] in turn (the last repeats), with every wait recorded. */
    private class Flaky(vararg answers: Boolean, local: () -> Boolean? = { true }) {
        val probes = mutableListOf<String>()
        val waits = mutableListOf<Long>()
        val clock = TestClock(0)
        private var i = 0
        val r = RoutePicker(
            localNetwork = { local() },
            probe = { url, _ -> probes += url; answers[minOf(i++, answers.size - 1)] },
            clock = clock,
            pause = { waits += it },
        )
    }

    @Test
    fun aNetworkChangeDropsTheChoiceSoTheNextPickLooksAgain() = runTest {
        val p = Flaky(true)
        p.r.pick(both)
        p.r.pick(both)
        assertEquals(1, p.probes.size) // remembered
        p.r.networkChanged()
        assertEquals(Where.HOME, p.r.pick(both).where)
        assertEquals(2, p.probes.size)
    }

    @Test
    fun aHomeProbeThatFailsRightAfterJoiningWifiIsRetriedBeforeSettlingOnAway() = runTest {
        val p = Flaky(false, false, true) // Wi-Fi joined, DNS not ready, then ready
        assertEquals(Picked(HOME, Where.HOME), p.r.pick(both))
        assertEquals(3, p.probes.size)
        assertEquals(RouteTimes.RETRY_AFTER_MS.toList(), p.waits)
    }

    @Test
    fun whenEveryRetryFailsItSettlesOnAwayAndTheRetriesAreNotRepeatedForTheSameNetwork() = runTest {
        val p = Flaky(false)
        assertEquals(Picked(AWAY, Where.AWAY), p.r.pick(both))
        assertEquals(1 + RouteTimes.RETRY_AFTER_MS.size, p.probes.size)
        p.clock.now = RouteTimes.REMEMBER_AWAY_ON_LAN_MS // the short memo is over
        p.waits.clear()
        p.r.pick(both)
        assertEquals(2 + RouteTimes.RETRY_AFTER_MS.size, p.probes.size) // one probe, no retries
        assertEquals(emptyList(), p.waits)
        p.r.networkChanged()
        p.r.pick(both)
        assertEquals(RouteTimes.RETRY_AFTER_MS.toList(), p.waits) // a new network: retries again
    }

    @Test
    fun anAwayPickAfterAFailedHomeProbeOnWifiIsNotKeptForAMinute() = runTest {
        val p = Flaky(false)
        p.r.pick(both)
        val probed = p.probes.size
        p.clock.now = RouteTimes.REMEMBER_AWAY_ON_LAN_MS - 1
        p.r.pick(both)
        assertEquals(probed, p.probes.size) // briefly remembered
        p.clock.now = RouteTimes.REMEMBER_AWAY_ON_LAN_MS
        p.r.pick(both)
        assertTrue(p.probes.size > probed) // looked again long before 60 s
        assertTrue(RouteTimes.REMEMBER_AWAY_ON_LAN_MS < RouteTimes.REMEMBER_MS)
    }

    @Test
    fun anAwayPickWhoseRequestGotNoAnswerIsForgottenAtOnce() = runTest {
        val p = Flaky(false)
        p.r.pick(both)
        val probed = p.probes.size
        p.r.forget() // what the API client's onUnreachable does
        p.r.pick(both)
        assertTrue(p.probes.size > probed)
    }

    @Test
    fun mobileDataIsAwayWithoutProbingOrWaiting() = runTest {
        val p = Flaky(true, local = { false })
        assertEquals(Where.AWAY, p.r.pick(both).where)
        assertEquals(emptyList(), p.probes)
        assertEquals(emptyList(), p.waits)
    }

    @Test
    fun theRetriesStopWhenThePhoneMovedToMobileDataMeanwhile() = runTest {
        var local: Boolean? = true
        val p = Flaky(false, local = { local })
        val r = RoutePicker(localNetwork = { local }, probe = { _, _ -> false }, clock = p.clock, pause = { local = false; p.waits += it })
        assertEquals(Where.AWAY, r.pick(both).where)
        assertEquals(1, p.waits.size)
    }

    @Test
    fun theProbeStillWantsTheSameInstanceSoTheTokenNeverGoesToAnotherServer() = runTest {
        // The retries probe with the credential's instance id each time.
        val ids = mutableListOf<String?>()
        val r = RoutePicker(localNetwork = { true }, probe = { _, id -> ids += id; false }, clock = TestClock(0), pause = {})
        r.pick(both)
        assertEquals<List<String?>>(List(1 + RouteTimes.RETRY_AFTER_MS.size) { "inst-1" }, ids)
    }

    @Test
    fun theProbeWantsAQuickMileWageAnswerFromTheSameServer() = runTest {
        fun answer(headers: Map<String, String>, status: Int = 200) =
            HealthProbe.over({ HttpResponse(status, HttpHeaders(headers), "{}".encodeToByteArray()) })
        val mw = mapOf("X-MileWage-Api" to "1", "X-MileWage-Instance" to "inst-1")
        assertTrue(answer(mw)(HOME, "inst-1"))
        assertTrue(answer(mw)(HOME, null))
        assertFalse(answer(mw)(HOME, "inst-2")) // another MileWage on that address
        assertFalse(answer(emptyMap())(HOME, null)) // not MileWage
        assertFalse(answer(mw, 503)(HOME, "inst-1"))
        assertFalse(HealthProbe.over({ throw TransportFailure.NoAnswer() })(HOME, null))
        val never = HealthProbe.over({ awaitCancellation() }, timeoutMs = 20)
        assertFalse(never(HOME, null)) // gives up after the timeout
        val seen = mutableListOf<HttpRequest>()
        HealthProbe.over(HttpTransport { seen += it; HttpResponse(200, HttpHeaders(mw), ByteArray(0)) })("$HOME/", null)
        assertEquals("$HOME/healthz", seen.single().url)
        assertEquals(RouteTimes.PROBE_MS, seen.single().timeoutMs)
    }

    // ---- identity on every answer (15 section 9.4)

    @Test
    fun anotherInstanceIsAWrongServerAnAnswerWithoutTheHeaderIsNot() {
        fun h(vararg p: Pair<String, String>) = HttpHeaders(mapOf(*p))
        assertTrue(ServerIdentity.isWrongServer(h("X-MileWage-Instance" to "inst-B"), "inst-A"))
        assertFalse(ServerIdentity.isWrongServer(h("x-milewage-instance" to "inst-A"), "inst-A"))
        assertFalse(ServerIdentity.isWrongServer(h(), "inst-A")) // a captive portal
        assertFalse(ServerIdentity.isWrongServer(h("X-MileWage-Instance" to "inst-B"), null)) // not known yet
        assertEquals(
            ServerIdentity("1", "0.2.0", "inst-A", 3),
            ServerIdentity.of(h("X-MileWage-Api" to "1", "X-MileWage-Server" to "0.2.0", "X-MileWage-Instance" to "inst-A", "X-MileWage-Restore-Gen" to "3")),
        )
    }
}
