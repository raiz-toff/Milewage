package app.milewage.data.net

import app.milewage.core.api.Api
import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.HttpMethod
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.ShiftRequests
import app.milewage.core.api.TelemetryPoint
import app.milewage.core.api.TransportFailure
import app.milewage.core.connect.HealthProbe
import app.milewage.core.pairing.MemoryStore
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingDeps
import app.milewage.core.pairing.PairingLink
import app.milewage.core.ports.Clock
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Dns
import okio.Buffer
import okio.GzipSource
import okio.buffer
import org.junit.After
import org.junit.Before
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The OkHttp transport and the whole client stack against a real HTTP server on this machine
 * (MockWebServer). Names are pointed at it with a fake DNS, so the home-only cleartext gate runs
 * with its release rule (anyHttp = false) on real requests.
 */
class OkHttpTransportTest {
    private val server = MockWebServer()
    private val clock = Clock { 42 }

    /** The release client, with home and foreign names resolving to the test server. */
    private fun client(anyHttp: Boolean = false) = HttpClients.create(anyHttp).newBuilder()
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> = listOf(InetAddress.getLoopbackAddress())
        })
        .build()

    private val home get() = "http://milewage.lan:${server.port}"
    private val foreign get() = "http://box.example.com:${server.port}"

    private fun answer(code: Int, body: String, vararg headers: Pair<String, String>) = server.enqueue(
        MockResponse.Builder().code(code).body(body).addHeader("X-MileWage-Api", "1")
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }.build(),
    )

    @Before
    fun start() = server.start()

    @After
    fun stop() = server.close()

    @Test
    fun aHomeAddressGoesOutOverPlainHttpAForeignOneNever() = runBlocking {
        val t = OkHttpTransport(client())
        answer(200, """{"ok":true}""")
        assertEquals(200, t.exchange(HttpRequest(HttpMethod.GET, "$home/healthz")).status)
        assertFailsWith<TransportFailure.Insecure> { t.exchange(HttpRequest(HttpMethod.GET, "$foreign/healthz")) }
        assertEquals(1, server.requestCount) // the foreign one never left
        // A debug build may use any address.
        answer(200, """{"ok":true}""")
        assertEquals(200, OkHttpTransport(client(anyHttp = true)).exchange(HttpRequest(HttpMethod.GET, "$foreign/healthz")).status)
    }

    @Test
    fun aRedirectFromHomeToAForeignHttpAddressIsRefusedAtTheHop() = runBlocking {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "$foreign/elsewhere").build())
        assertFailsWith<TransportFailure.Insecure> { OkHttpTransport(client()).exchange(HttpRequest(HttpMethod.GET, "$home/healthz")) }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun sendsMethodHeadersAndAGzippedBodyAndReadsTheAnswer() = runBlocking {
        answer(200, """{"inserted":1,"duplicates":0,"rejected":[],"server_time":1,"upload_hint_s":60}""", "X-MileWage-Instance" to "inst-1")
        val api = ApiClient(OkHttpTransport(client()), { home }, clock, token = "mwd_x")
        val req = ShiftRequests.encode(
            ShiftChange.Points("11111111-1111-4111-8111-111111111111", listOf(TelemetryPoint(1, 2, 3, 4, 5, null, null, null))),
        )
        val res = api.send(req)
        assertEquals(200, res.status)
        assertEquals("inst-1", res.headers["x-milewage-instance"])
        val r = server.takeRequest()
        assertEquals("POST", r.method)
        assertEquals("/api/v1/telemetry/batch", r.target)
        assertEquals("Bearer mwd_x", r.headers["Authorization"])
        assertEquals("42", r.headers["X-Client-Time"])
        assertEquals("gzip", r.headers["Content-Encoding"])
        assertTrue(r.headers["Content-Type"]!!.startsWith("application/json"))
        val plain = GzipSource(Buffer().write(r.body!!)).buffer().readUtf8()
        assertEquals(req.body.toString(), plain)
    }

    @Test
    fun refusalsBecomeTheTypedErrors() = runBlocking {
        answer(503, """{"type":"/api/v1/errors/read_only_mode","title":"x","status":503,"code":"read_only_mode","retryable":true}""", "Retry-After" to "60")
        val api = ApiClient(OkHttpTransport(client()), { home }, clock, token = "mwd_x")
        val e = assertFailsWith<ApiException> { api.call(Api.settings) }
        assertEquals("read_only_mode", e.code)
        assertEquals(60, e.retryAfterS)
        assertTrue(e.retryable)
    }

    @Test
    fun noAnswerIsANetworkFailure() = runBlocking {
        val port = server.port
        server.close()
        val api = ApiClient(OkHttpTransport(client()), { "http://milewage.lan:$port" }, clock)
        val e = assertFailsWith<ApiException> { api.call(Api.settings) }
        assertEquals(ApiCodes.NETWORK, e.code)
        assertTrue(e.retryable)
    }

    @Test
    fun theHealthProbeGivesUpOnASlowServer() = runBlocking {
        server.enqueue(MockResponse.Builder().code(200).body("{}").addHeader("X-MileWage-Api", "1").headersDelay(2, TimeUnit.SECONDS).build())
        val started = System.nanoTime()
        assertFalse(HealthProbe.over(OkHttpTransport(client()), timeoutMs = 200)(home, null))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 1_500)
        answer(200, """{"ok":true}""", "X-MileWage-Instance" to "inst-1")
        assertTrue(HealthProbe.over(OkHttpTransport(client()))(home, "inst-1"))
    }

    @Test
    fun pairingAtAHomeAddressStoresItAndItsRequestsPassTheReleaseGate() = runBlocking {
        val settings = """{"country":"US","distance_unit":"mi","currency":"USD","timezone":"America/New_York",
            "stops_enabled":true,"engine_version":1,"diagnostics":{"level":"basic","verbose_until":null},
            "modules":{"tracking":true}}"""
        answer(201, """{"device_id":7,"device_token":"mwd_${"b".repeat(43)}","settings":$settings,"home_url":"$home","away_url":null}""", "X-MileWage-Instance" to "inst-1")
        answer(200, settings, "X-MileWage-Instance" to "inst-1")
        val pairing = Pairing(PairingDeps(MemoryStore(), MemoryStore(), OkHttpTransport(client()), clock, appVersion = "0.3.0"))
        val state = pairing.redeem(PairingLink(home, "mwp_" + "a".repeat(43)))
        assertEquals(home, state.credential.homeUrl)
        assertNull(state.credential.awayUrl)
        val session = pairing.session()!!
        assertEquals("USD", session.client.call(Api.settings).data.currency) // plain http to the paired home address
        assertEquals(listOf("/api/v1/pairing/redeem", "/api/v1/settings"), listOf(server.takeRequest().target, server.takeRequest().target))
    }
}
