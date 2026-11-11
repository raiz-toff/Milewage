package app.milewage.core.pairing

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiJson
import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.Segmenter
import app.milewage.core.api.Settings
import app.milewage.core.api.TransportFailure
import app.milewage.core.connect.HealthProbe
import app.milewage.core.connect.RoutePicker
import app.milewage.core.connect.Where
import app.milewage.core.ports.SecretStore
import app.milewage.core.support.AWAY
import app.milewage.core.support.DEVICE_TOKEN
import app.milewage.core.support.FakeServer
import app.milewage.core.support.HOME
import app.milewage.core.support.Offline
import app.milewage.core.support.QR
import app.milewage.core.support.Recorded
import app.milewage.core.support.SETTINGS
import app.milewage.core.support.TOKEN
import app.milewage.core.support.TestClock
import app.milewage.core.support.json
import app.milewage.core.support.paired
import app.milewage.core.support.pairedWith
import app.milewage.core.support.problem
import app.milewage.core.support.settings
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Expo app's pairing.test.tsx, homeaway.test.ts ("a phone with both addresses"),
 * deviceSession.test.ts (the pairing side), repair.test.tsx (re-pairing lifts every halt),
 * secureStore.test.ts (the credential across restarts) and connect.test.tsx (not MileWage).
 */
class PairingTest {
    /** The Expo tests' `makeServices`: memory stores, the home/away picker over the same transport. */
    private class Kit(
        val transport: HttpTransport,
        var local: Boolean? = true,
        val secure: MemoryStore = MemoryStore(),
        val plain: MemoryStore = MemoryStore(),
        secureOverride: SecretStore? = null,
    ) {
        val clock = TestClock()
        val heardSettings = mutableListOf<Settings>()
        val route = RoutePicker(localNetwork = { local }, probe = HealthProbe.over(transport), clock = clock)
        val pairing = Pairing(
            PairingDeps(
                secure = secureOverride ?: secure,
                plain = plain,
                transport = transport,
                clock = clock,
                appVersion = "0.3.0",
                route = route,
                onSettings = { heardSettings += it },
            ),
        )
    }

    private fun okServer() = FakeServer(
        mutableMapOf(
            "POST /pairing/redeem" to { _: Recorded -> json(201, paired(), mapOf("X-MileWage-Instance" to "inst-1")) },
            "GET /settings" to { _: Recorded -> json(200, settings("distance_unit" to JsonPrimitive("km"))) },
        ),
    )

    private val qr get() = PairingLinks.parse(QR)!!

    // ---- redeem against the mock server

    @Test
    fun storesTheCredentialSecurelyAndTheSettingsInTheCacheSendsNoAuth() = runTest {
        val server = okServer()
        val k = Kit(server)
        val state = k.pairing.redeem(qr)
        assertEquals(Credential("https://mw.example.net", null, "https://mw.example.net", 7, DEVICE_TOKEN, "inst-1"), state.credential)
        val call = server.calls[0]
        assertNull(call.headers["Authorization"])
        val body = call.body!!.jsonObject
        assertEquals(TOKEN, body["token"]!!.jsonPrimitive.content)
        assertEquals("android", body["platform"]!!.jsonPrimitive.content)
        assertEquals("Android phone", body["device_name"]!!.jsonPrimitive.content)
        assertEquals("0.3.0", body["app_version"]!!.jsonPrimitive.content)
        assertTrue(k.secure.get(Pairing.KEY_CREDENTIAL)!!.contains(DEVICE_TOKEN))
        assertNull(k.plain.get(Pairing.KEY_CREDENTIAL))
        assertFalse(k.plain.snapshot().values.any { DEVICE_TOKEN in it }) // the token is only in the secure store
        assertEquals("mi", ApiJson.parseToJsonElement(k.plain.get(Pairing.KEY_SETTINGS)!!).jsonObject["distance_unit"]!!.jsonPrimitive.content)
        assertEquals(7, k.pairing.load()?.credential?.deviceId)
        assertEquals(1, k.heardSettings.size)
        assertTrue(k.pairing.setupPending()) // a first connection: the setup steps follow
        assertFalse(state.credential.toString().contains(DEVICE_TOKEN))
    }

    @Test
    fun invalidPairingTokenStoresNothing() = runTest {
        val k = Kit(FakeServer(mutableMapOf("POST /pairing/redeem" to { _: Recorded -> problem(401, "invalid_pairing_token") })))
        val e = assertFailsWith<ApiException> { k.pairing.redeem(qr) }
        assertEquals(401, e.status)
        assertEquals("invalid_pairing_token", e.code)
        assertTrue(k.secure.snapshot().isEmpty())
    }

    @Test
    fun aNetworkFailureIsARetryableApiException() = runTest {
        val e = assertFailsWith<ApiException> { Kit(Offline).pairing.redeem(qr) }
        assertEquals(ApiCodes.NETWORK, e.code)
        assertTrue(e.retryable)
    }

    @Test
    fun anAnswerWithoutTheMileWageHeaderIsNotAMileWageServer() = runTest {
        val html = HttpTransport { HttpResponse(404, HttpHeaders(mapOf("Content-Type" to "text/html")), "<html>".encodeToByteArray()) }
        assertEquals(ApiCodes.NOT_MILEWAGE, assertFailsWith<ApiException> { Kit(html).pairing.redeem(PairingLink(AWAY, TOKEN)) }.code)
        val portal = HttpTransport { HttpResponse(200, HttpHeaders(emptyMap()), "<html>".encodeToByteArray()) }
        assertEquals(ApiCodes.NOT_MILEWAGE, assertFailsWith<ApiException> { Kit(portal).pairing.redeem(PairingLink(AWAY, TOKEN)) }.code)
    }

    @Test
    fun aStrangeCredentialIsABadResponse() = runTest {
        val odd = buildJsonObject {
            put("device_id", 7)
            put("device_token", "nope")
            put("settings", SETTINGS)
        }
        val k = Kit(FakeServer(mutableMapOf("POST /pairing/redeem" to { _: Recorded -> json(201, odd) })))
        assertEquals(ApiCodes.BAD_RESPONSE, assertFailsWith<ApiException> { k.pairing.redeem(qr) }.code)
        assertNull(k.pairing.load())
    }

    @Test
    fun refreshSettingsSendsTheBearerAndReplacesTheCacheFailureKeepsTheCache() = runTest {
        val server = okServer()
        val k = Kit(server)
        val state = k.pairing.redeem(qr)
        val (fresh, error) = k.pairing.refreshSettings(state)
        assertNull(error)
        assertEquals("KM", fresh.settings?.distanceUnit?.name)
        val get = server.calls.first { it.method == "GET" }
        assertEquals("Bearer $DEVICE_TOKEN", get.headers["Authorization"])
        assertTrue(get.headers["X-Client-Time"]!!.toLong() > 0)

        val down = Kit(FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> problem(401, "device_revoked") })))
        val (kept, bad) = down.pairing.refreshSettings(state)
        assertEquals("device_revoked", bad?.code)
        assertEquals("MI", kept.settings?.distanceUnit?.name)
    }

    @Test
    fun statusPairedRevokedWhenTheServerRefusesThePhoneClearedByANewPairing() = runTest {
        var revoked = false
        val server = okServer()
        server.routes["GET /settings"] = { if (revoked) problem(401, "device_revoked") else json(200, SETTINGS) }
        val k = Kit(server)
        var changes = 0
        k.pairing.subscribe { changes++ }
        assertEquals(PairingStatus.UNPAIRED, k.pairing.status())
        val state = k.pairing.redeem(qr)
        assertEquals(PairingStatus.PAIRED, k.pairing.status())
        k.pairing.refreshSettings(state)
        assertEquals(PairingStatus.PAIRED, k.pairing.status()) // a good answer changes nothing
        revoked = true
        k.pairing.refreshSettings(state)
        assertEquals(PairingStatus.REVOKED, k.pairing.status())
        assertNotNull(k.pairing.load()) // nothing deleted
        revoked = false
        k.pairing.redeem(qr)
        assertEquals(PairingStatus.PAIRED, k.pairing.status())
        assertEquals(3, changes)
        assertTrue(k.pairing.setupPending())
        k.pairing.finishSetup()
        assertFalse(k.pairing.setupPending())
        assertEquals(4, changes)
    }

    @Test
    fun theStatusFlowFollowsEveryChange() = runTest {
        val k = Kit(okServer())
        val seen = mutableListOf<PairingStatus>()
        val job = backgroundScope.async { k.pairing.statusFlow().collect { seen += it } }
        testScheduler.runCurrent()
        k.pairing.redeem(qr)
        testScheduler.runCurrent()
        k.pairing.unpair()
        testScheduler.runCurrent()
        job.cancel()
        assertEquals(listOf(PairingStatus.UNPAIRED, PairingStatus.PAIRED, PairingStatus.UNPAIRED), seen)
    }

    @Test
    fun unpairForgetsTheCredentialUnlessDataWaits() = runTest {
        val k = Kit(okServer())
        k.pairing.redeem(qr)
        assertFalse(k.pairing.unpair(waiting = { true }))
        assertNotNull(k.pairing.load())
        assertTrue(k.pairing.unpair())
        assertNull(k.pairing.load())
        assertFalse(k.pairing.setupPending())
        assertNull(k.plain.get(Pairing.KEY_SETTINGS))
    }

    @Test
    fun flagsDeriveFromModulesAndStopsEnabled() {
        fun s(vararg over: Pair<String, kotlinx.serialization.json.JsonElement>) =
            ApiJson.decodeFromJsonElement(Settings.serializer(), settings(*over))
        val f = Flags.of(s())
        assertTrue(f.tracking)
        assertTrue(f.stops)
        assertEquals(Segmenter.STOPS, f.segmenter)
        val off = Flags.of(s("stops_enabled" to JsonPrimitive(false)))
        assertFalse(off.stops)
        assertEquals(Segmenter.WHOLE_SHIFT, off.segmenter)
        val noTracking = Flags.of(s("modules" to buildJsonObject { put("tracking", false); put("stops", true) }))
        assertFalse(noTracking.tracking)
        assertFalse(noTracking.stops)
        assertFalse(Flags.of(null).diagnostics)
        assertTrue(Flags.of(null).sync)
        assertEquals("UTC", Flags.of(null).timezone)
    }

    // ---- a phone with both addresses (plan 28)

    /** A home server and an away server; `homeUp` turns the home one off (out of the house). */
    private class TwoServers(val instance: String = "inst-1") : HttpTransport {
        var homeUp = true
        val calls = mutableListOf<String>()

        override suspend fun exchange(request: app.milewage.core.api.HttpRequest): HttpResponse {
            calls += "${request.method} ${request.url}"
            if (request.url.startsWith(HOME) && !homeUp) throw TransportFailure.NoAnswer()
            val headers = mapOf("X-MileWage-Instance" to instance)
            return when {
                request.url.endsWith("/healthz") -> json(200, """{"ok":true}""", headers)
                request.url.endsWith("/pairing/redeem") -> json(201, paired(home = HOME, away = AWAY), headers)
                else -> json(200, SETTINGS, headers)
            }
        }
    }

    private fun code(h: String?) = PairingLink(AWAY, TOKEN, h)

    @Test
    fun redeemsACodeAtHomeOnTheWifiAndKeepsBothAddresses() = runTest {
        val s = TwoServers()
        val state = Kit(s).pairing.redeem(code(HOME))
        assertEquals(listOf("GET $HOME/healthz", "POST $HOME/api/v1/pairing/redeem"), s.calls)
        assertEquals(Triple(HOME, HOME, AWAY), Triple(state.credential.baseUrl, state.credential.homeUrl, state.credential.awayUrl))
    }

    @Test
    fun onMobileDataItRedeemsAtTheAwayAddressAndLearnsHomeFromTheCode() = runTest {
        val s = TwoServers()
        val state = Kit(s, local = false).pairing.redeem(code(HOME))
        assertEquals(listOf("POST $AWAY/api/v1/pairing/redeem"), s.calls)
        assertEquals(Triple(AWAY, HOME, AWAY), Triple(state.credential.baseUrl, state.credential.homeUrl, state.credential.awayUrl))
    }

    @Test
    fun sendsHomeWhileHomeAnswersAndAwayOnceItStopsWithoutAskingTheDriver() = runTest {
        val s = TwoServers()
        val k = Kit(s)
        k.pairing.redeem(code(HOME))
        s.calls.clear()
        val session = k.pairing.session()!!
        session.client.call(app.milewage.core.api.Api.settings)
        assertEquals(listOf("GET $HOME/healthz", "GET $HOME/api/v1/settings"), s.calls)
        assertEquals(Where.HOME, k.pairing.where)
        s.homeUp = false // the driver leaves the house
        s.calls.clear()
        assertEquals(ApiCodes.NETWORK, assertFailsWith<ApiException> { session.client.call(app.milewage.core.api.Api.settings) }.code)
        session.client.call(app.milewage.core.api.Api.settings) // looks again: home is gone, away it is
        assertEquals(listOf("GET $HOME/api/v1/settings", "GET $HOME/healthz", "GET $AWAY/api/v1/settings"), s.calls)
        assertEquals(Where.AWAY, k.pairing.where)
    }

    @Test
    fun aServerAnswerCannotLowerTheRulesHomeMustBeAHomeAddressAwayHttps() = runTest {
        val evil = FakeServer(
            mutableMapOf(
                "POST /pairing/redeem" to { _: Recorded ->
                    json(201, paired(home = "http://evil.example.com", away = "http://box.example.com"))
                },
            ),
        )
        val home = Kit(evil).pairing.redeem(PairingLink(HOME, TOKEN)).credential
        assertEquals(HOME to null, home.homeUrl to home.awayUrl)
        val away = Kit(evil).pairing.redeem(PairingLink(AWAY, TOKEN)).credential
        assertEquals(null to AWAY, away.homeUrl to away.awayUrl)
    }

    // ---- the device session through pairing

    @Test
    fun aRevokeReachesTheAppStartGateThroughPairingAndUnpairingLiftsIt() = runTest {
        val k = Kit(FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> problem(401, "device_revoked") })))
        k.secure.pairedWith()
        var changes = 0
        k.pairing.subscribe { changes++ }
        k.pairing.refreshSettings(k.pairing.load()!!)
        assertEquals(PairingStatus.REVOKED, k.pairing.status())
        assertEquals(HaltReason.REPAIR, k.pairing.device.halted())
        assertTrue(changes > 0)
        k.pairing.unpair()
        assertNull(k.pairing.device.halted())
    }

    @Test
    fun a403StopsSendingAsASignInProblemAndPairingAgainLiftsIt() = runTest {
        val server = okServer()
        server.routes["GET /settings"] = { problem(403, "scope_forbidden") }
        val k = Kit(server)
        k.secure.pairedWith()
        k.pairing.refreshSettings(k.pairing.load()!!)
        assertEquals(HaltReason.AUTH_PROBLEM, k.pairing.device.halted())
        assertEquals(PairingStatus.PAIRED, k.pairing.status())
        k.pairing.redeem(qr)
        assertNull(k.pairing.device.halted())
    }

    @Test
    fun anotherServerAtTheAddressBlocksEveryRequestUntilTheDriverRepairs() = runTest {
        var inst = "inst-A"
        val server = FakeServer(
            mutableMapOf(
                "GET /settings" to { _: Recorded -> json(200, SETTINGS, mapOf("X-MileWage-Instance" to inst)) },
                "POST /pairing/redeem" to { _: Recorded -> json(201, paired(deviceId = 8), mapOf("X-MileWage-Instance" to "inst-B")) },
            ),
        )
        val k = Kit(server)
        k.secure.pairedWith(token = "mwd_b", instanceId = "inst-A")
        val first = k.pairing.session()!!
        first.client.call(app.milewage.core.api.Api.settings)
        assertNull(k.pairing.device.halted())
        inst = "inst-B" // the address now answers as another server
        first.client.call(app.milewage.core.api.Api.settings)
        assertEquals(HaltReason.WRONG_SERVER, k.pairing.device.halted())
        val blocked = server.calls.size
        val e = assertFailsWith<ApiException> { first.client.call(app.milewage.core.api.Api.settings) }
        assertEquals(ApiCodes.WRONG_SERVER, e.code)
        assertTrue(e.retryable) // queued data is kept
        assertEquals(blocked, server.calls.size) // nothing goes out

        // "Re-pair to the new server": Settings disconnects, then the phone pairs with a new code.
        k.pairing.unpair()
        k.pairing.redeem(qr)
        val from = server.calls.size
        k.pairing.session()!!.client.call(app.milewage.core.api.Api.settings)
        assertEquals(listOf("GET /settings"), server.calls.drop(from).map { "${it.method} ${it.path}" })
        assertNull(k.pairing.device.halted())
    }

    @Test
    fun everyOtherAnswerReachesTheRestoreCheckWithThePairedInstance() = runTest {
        val seen = mutableListOf<Pair<Long?, String?>>()
        val server = FakeServer(
            mutableMapOf(
                "GET /settings" to { _: Recorded ->
                    json(200, SETTINGS, mapOf("X-MileWage-Instance" to "inst-A", "X-MileWage-Restore-Gen" to "4"))
                },
            ),
        )
        val secure = MemoryStore()
        secure.pairedWith(instanceId = "inst-A")
        val pairing = Pairing(
            PairingDeps(
                secure, MemoryStore(), server, TestClock(), "0.3.0",
                onAnswer = { id, expected -> seen += id.restoreGeneration to expected },
            ),
        )
        pairing.session()!!.client.call(app.milewage.core.api.Api.settings)
        assertEquals(listOf<Pair<Long?, String?>>(4L to "inst-A"), seen)
    }

    // ---- the credential across restarts (secureStore.test.ts)

    @Test
    fun theCredentialSurvivesARestartANewPairingOverTheSameStoresIsStillPaired() = runTest {
        val secure = MemoryStore()
        val plain = MemoryStore()
        Kit(okServer(), secure = secure, plain = plain).pairing.redeem(PairingLink("https://x.example", "mwp_abcdefghijklmnop"))
        val after = Kit(okServer(), secure = secure, plain = plain).pairing
        assertTrue(after.load()!!.credential.deviceToken.startsWith("mwd_"))
        assertEquals(listOf(Pairing.KEY_CREDENTIAL), secure.snapshot().keys.toList())
        after.unpair()
        assertNull(after.load())
    }

    @Test
    fun aLostKeystoreKeyMeansNotPairedNotACrash() = runTest {
        // KeystoreSecretStore answers null for a value it can no longer open.
        val lost = object : SecretStore {
            override suspend fun get(key: String): String? = null
            override suspend fun put(key: String, value: String) = Unit
            override suspend fun remove(key: String) = Unit
        }
        val k = Kit(okServer(), secureOverride = lost)
        k.pairing.redeem(qr)
        assertNull(k.pairing.load())
        assertNull(k.pairing.session())
        assertEquals(PairingStatus.UNPAIRED, k.pairing.status())
        val damaged = MemoryStore().apply { put(Pairing.KEY_CREDENTIAL, "{not json") }
        assertEquals(PairingStatus.UNPAIRED, Kit(okServer(), secure = damaged).pairing.status())
    }

    @Test
    fun aCredentialSavedByTheExpoAppReadsBack() = runTest {
        val secure = MemoryStore()
        secure.put(
            Pairing.KEY_CREDENTIAL,
            """{"baseUrl":"https://mw.example.net","deviceId":7,"deviceToken":"$DEVICE_TOKEN","instanceId":null}""",
        )
        val c = Kit(okServer(), secure = secure).pairing.load()!!.credential
        assertEquals(Credential("https://mw.example.net", null, null, 7, DEVICE_TOKEN, null), c)
    }
}
