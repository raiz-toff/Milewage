package app.milewage.core.api

import app.milewage.core.support.FakeServer
import app.milewage.core.support.HOME
import app.milewage.core.support.Offline
import app.milewage.core.support.Recorded
import app.milewage.core.support.SETTINGS
import app.milewage.core.support.TestClock
import app.milewage.core.support.json
import app.milewage.core.support.paired
import app.milewage.core.support.problem
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Expo client's behaviour (api/client.ts, homeaway.test.ts "plain http only on the home network"). */
class ApiClientTest {
    private val clock = TestClock(1_234)

    private fun client(server: HttpTransport, base: String = "https://mw.example.net", token: String? = null, anyHttp: Boolean = false, hooks: ApiHooks = ApiHooks()) =
        ApiClient(server, { base }, clock, token, anyHttp, hooks)

    private fun settingsServer() = FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> json(200, SETTINGS) }))

    @Test
    fun refusesHttpToAnyOtherAddressBeforeSendingAnything() = runTest {
        val server = settingsServer()
        for (bad in listOf("http://box.example.com", "http://8.8.8.8:8080", "http://box.ts.net", "http://localhost:8080")) {
            val e = assertFailsWith<ApiException> { client(server, bad).call(Api.settings) }
            assertEquals(ApiCodes.INSECURE_ADDRESS, e.code)
            assertFalse(e.retryable)
            assertEquals(ApiFailure.INSECURE_ADDRESS, e.failure)
        }
        assertEquals(emptyList(), server.calls)
        client(server, HOME).call(Api.settings)
        client(server, "http://milewage.local").call(Api.settings)
        client(server, "https://box.tail1234.ts.net").call(Api.settings)
        client(server, "http://box.example.com", anyHttp = true).call(Api.settings) // debug build
        assertEquals(4, server.calls.size)
    }

    @Test
    fun aRefusalByTheTransportGateIsAnInsecureAddressToo() = runTest {
        val e = assertFailsWith<ApiException> { client({ throw TransportFailure.Insecure() }).call(Api.settings) }
        assertEquals(ApiCodes.INSECURE_ADDRESS, e.code)
    }

    @Test
    fun sendsTheHeadersOfTheContract() = runTest {
        val server = settingsServer()
        server.routes["POST /pairing/redeem"] = { json(201, paired()) }
        client(server, token = "mwd_x").call(Api.settings)
        val get = server.calls.single()
        assertEquals("https://mw.example.net/api/v1/settings", get.url)
        assertEquals("application/json", get.headers["Accept"])
        assertEquals("1234", get.headers["X-Client-Time"])
        assertEquals("Bearer mwd_x", get.headers["Authorization"])
        assertNull(get.headers["Content-Type"])
        val res = client(server).call(Api.redeem, RedeemRequest("mwp_x", "Pixel 8", DevicePlatform.ANDROID))
        assertEquals(201, res.status)
        val post = server.calls.last()
        assertEquals("application/json", post.headers["Content-Type"])
        assertNull(post.headers["Authorization"])
    }

    @Test
    fun healthIsOutsideTheApiAndQueryAndPathAreEncoded() = runTest {
        val server = FakeServer(
            mutableMapOf(
                "GET /healthz" to { _: Recorded -> json(200, """{"ok":true}""") },
                "GET /sync/changes" to { _: Recorded -> json(200, """{"changes":[],"next_cursor":5,"has_more":false}""") },
            ),
        )
        assertTrue(client(server, "$HOME/").call(Api.health).data.ok)
        assertEquals("$HOME/healthz", server.calls[0].url)
        assertEquals(5, client(server).call(Api.pullChanges, query = listOf("after" to "0", "limit" to "200")).data.nextCursor)
        assertEquals("https://mw.example.net/api/v1/sync/changes?after=0&limit=200", server.calls[1].url)
        assertEquals(
            "/shifts/a/trip-overrides/a%3A1700000000000%3Adeadhead",
            Api.putTripOverride.pathWith(mapOf("ref" to "a", "trip_key" to "a:1700000000000:deadhead")),
        )
        assertFailsWith<IllegalArgumentException> { Api.endShift.pathWith() }
    }

    @Test
    fun readsTheProblemLeniently() = runTest {
        val server = FakeServer(
            mutableMapOf(
                "GET /settings" to { _: Recorded -> problem(503, "read_only_mode", retryable = true, headers = mapOf("Retry-After" to "60")) },
                "GET /vehicles" to { _: Recorded -> json(500, "not json") },
                "POST /shifts" to { _: Recorded -> json(409, """{"code":"shift_already_active","retryable":false,"active_shift":{}}""") },
            ),
        )
        val ro = assertFailsWith<ApiException> { client(server).call(Api.settings) }
        assertEquals(503, ro.status)
        assertEquals("read_only_mode", ro.code)
        assertTrue(ro.retryable)
        assertEquals(60, ro.retryAfterS)
        assertEquals(ApiFailure.READ_ONLY, ro.failure)
        assertEquals("read_only_mode", ro.problem?.code)
        assertEquals("503 read_only_mode", ro.message)
        val broken = assertFailsWith<ApiException> { client(server).call(Api.vehicles) }
        assertEquals("unknown", broken.code)
        assertTrue(broken.retryable) // 5xx without a problem body
        val conflict = assertFailsWith<ApiException> {
            client(server).call(Api.startShift, ShiftStart("11111111-1111-4111-8111-111111111111", 3, 1))
        }
        assertEquals(ApiFailure.CONFLICT, conflict.failure)
        assertFalse(conflict.retryable)
    }

    @Test
    fun anAnswerItCannotReadIsBadResponse() = runTest {
        val notJson = FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> json(200, "<html>") }))
        assertEquals(ApiCodes.BAD_RESPONSE, assertFailsWith<ApiException> { client(notJson).call(Api.settings) }.code)
        val wrongShape = FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> json(200, """{"country":"US"}""") }))
        assertEquals(ApiFailure.BAD_RESPONSE, assertFailsWith<ApiException> { client(wrongShape).call(Api.settings) }.failure)
    }

    @Test
    fun noAnswerIsARetryableNetworkFailureAndTheRouteIsForgotten() = runTest {
        var forgotten = 0
        val e = assertFailsWith<ApiException> { client(Offline, hooks = ApiHooks(onUnreachable = { forgotten++ })).call(Api.settings) }
        assertEquals(ApiCodes.NETWORK, e.code)
        assertTrue(e.retryable)
        assertEquals(0, e.status)
        assertEquals(ApiFailure.UNREACHABLE, e.failure)
        assertEquals(1, forgotten)
    }

    @Test
    fun blockedSendsNothing() = runTest {
        val server = settingsServer()
        val e = assertFailsWith<ApiException> { client(server, hooks = ApiHooks(blocked = { true })).call(Api.settings) }
        assertEquals(ApiCodes.WRONG_SERVER, e.code)
        assertTrue(e.retryable)
        assertEquals(emptyList(), server.calls)
    }

    @Test
    fun hooksSeeEveryAnswerAndEveryRefusal() = runTest {
        val server = settingsServer()
        server.routes["GET /vehicles"] = { problem(401, "device_revoked") }
        val headers = mutableListOf<String?>()
        val problems = mutableListOf<String>()
        val c = client(server, hooks = ApiHooks(onResponse = { headers += it["x-milewage-api"] }, onProblem = { problems += it.code }))
        c.call(Api.settings)
        assertFailsWith<ApiException> { c.call(Api.vehicles) }
        assertEquals(listOf<String?>("1", "1"), headers)
        assertEquals(listOf("device_revoked"), problems)
    }

    @Test
    fun anotherApiMajorIsRefusedAndTooOldIsNamed() = runTest {
        val newer = FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> json(200, SETTINGS, mapOf("X-MileWage-Api" to "2")) }))
        val e = assertFailsWith<ApiException> { client(newer).call(Api.settings) }
        assertEquals(ApiFailure.API_UNSUPPORTED, e.failure)
        val old = FakeServer(mutableMapOf("GET /settings" to { _: Recorded -> problem(426, "upgrade_required") }))
        assertEquals(ApiFailure.APP_TOO_OLD, assertFailsWith<ApiException> { client(old).call(Api.settings) }.failure)
    }

    @Test
    fun theFailureKindsCoverTheServerCatalogue() {
        fun f(status: Int, code: String) = ApiFailure.of(status, code)
        assertEquals(ApiFailure.REVOKED, f(401, "device_revoked"))
        assertEquals(ApiFailure.INVALID_CODE, f(401, "invalid_pairing_token"))
        assertEquals(ApiFailure.UNAUTHORIZED, f(401, "auth_required"))
        assertEquals(ApiFailure.FORBIDDEN, f(403, "scope_forbidden"))
        assertEquals(ApiFailure.RESTORING, f(503, "restoring"))
        assertEquals(ApiFailure.SERVER_FULL, f(507, "insufficient_storage"))
        assertEquals(ApiFailure.RATE_LIMITED, f(429, "rate_limited"))
        assertEquals(ApiFailure.GONE, f(410, "cursor_expired"))
        assertEquals(ApiFailure.NOT_FOUND, f(404, "shift_not_found"))
        assertEquals(ApiFailure.TOO_LARGE, f(413, "payload_too_large"))
        assertEquals(ApiFailure.INVALID, f(422, "validation_failed"))
        assertEquals(ApiFailure.SERVER_ERROR, f(500, "internal_error"))
        assertEquals(ApiFailure.NOT_MILEWAGE, f(404, "not_milewage"))
        assertEquals(ApiFailure.OTHER, f(418, "teapot"))
    }

    @Test
    fun sendsAShiftRequestAsBuiltGzipForPoints() = runTest {
        val seen = mutableListOf<HttpRequest>()
        val transport = HttpTransport { r -> seen += r; json(200, """{"inserted":1,"duplicates":0,"rejected":[],"server_time":1,"upload_hint_s":60}""") }
        val req = ShiftRequests.encode(
            ShiftChange.Points("11111111-1111-4111-8111-111111111111", listOf(TelemetryPoint(1, 1, 1, 1, 5, null, null, null))),
        )
        val res = client(transport).send(req)
        assertEquals(1, res.data.jsonObject["inserted"].toString().toInt())
        assertTrue(seen.single().gzip)
        assertEquals(HttpMethod.POST, seen.single().method)
        assertEquals("https://mw.example.net/api/v1/telemetry/batch", seen.single().url)
        assertEquals(req.body.toString(), seen.single().body!!.decodeToString())
    }
}
