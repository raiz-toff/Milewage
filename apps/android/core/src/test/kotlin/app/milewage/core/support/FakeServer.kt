package app.milewage.core.support

import app.milewage.core.api.ApiJson
import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.TransportFailure
import app.milewage.core.pairing.MemoryStore
import app.milewage.core.ports.Clock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** One recorded request. [path] is without the origin and without `/api/v1`. */
data class Recorded(
    val method: String,
    val url: String,
    val path: String,
    val headers: Map<String, String>,
    val body: JsonElement?,
) {
    val line: String get() = "$method $url"
}

/** A MileWage answer: JSON with the header every MileWage response carries. */
fun json(status: Int, body: String, headers: Map<String, String> = emptyMap()) =
    HttpResponse(status, HttpHeaders(mapOf("Content-Type" to "application/json", "X-MileWage-Api" to "1") + headers), body.encodeToByteArray())

fun json(status: Int, body: JsonElement, headers: Map<String, String> = emptyMap()) = json(status, body.toString(), headers)

fun problem(status: Int, code: String, retryable: Boolean = false, headers: Map<String, String> = emptyMap()) = json(
    status,
    buildJsonObject {
        put("type", "/api/v1/errors/$code")
        put("title", code)
        put("status", status)
        put("code", code)
        put("retryable", retryable)
    },
    headers,
)

/** A transport answering from [routes] keyed `METHOD /path` (path without /api/v1); every call is recorded. */
class FakeServer(val routes: MutableMap<String, (Recorded) -> HttpResponse> = mutableMapOf()) : HttpTransport {
    val calls = mutableListOf<Recorded>()

    /** Every call as `METHOD url`. */
    val lines: List<String> get() = calls.map { it.line }

    override suspend fun exchange(request: HttpRequest): HttpResponse {
        val path = PATH.find(request.url)?.groupValues?.get(1)?.substringBefore('?')?.removePrefix("/api/v1") ?: ""
        val body = request.body?.decodeToString()?.let { ApiJson.parseToJsonElement(it) }
        val r = Recorded(request.method.name, request.url, path, request.headers, body)
        calls += r
        val handler = routes["${r.method} $path"] ?: return problem(404, "not_found")
        return handler(r)
    }

    private companion object {
        val PATH = Regex("""^https?://[^/]+(/.*)?$""")
    }
}

/** A transport that never gets an answer. */
object Offline : HttpTransport {
    override suspend fun exchange(request: HttpRequest): HttpResponse = throw TransportFailure.NoAnswer("offline")
}

class TestClock(var now: Long = 1_700_000_000_000) : Clock {
    override fun nowMs(): Long = now
}

const val TOKEN = "mwp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const val DEVICE_TOKEN = "mwd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const val HOME = "http://192.168.1.20:8080"
const val AWAY = "https://box.tail1234.ts.net"
const val QR = "milewage://pair?v=1&u=https%3A%2F%2Fmw.example.net&t=$TOKEN"

/** The Expo tests' SETTINGS (a 0.1 server's settings: the newer members absent). */
val SETTINGS: JsonObject = ApiJson.parseToJsonElement(
    """
    {"country":"US","distance_unit":"mi","currency":"USD","timezone":"America/New_York","stops_enabled":true,
     "engine_version":1,"diagnostics":{"level":"basic","verbose_until":null},
     "modules":{"tracking":true,"stops":true,"diagnostics":true}}
    """.trimIndent(),
).jsonObject

fun settings(vararg over: Pair<String, JsonElement>): JsonObject = JsonObject(SETTINGS + over)

fun paired(
    deviceId: Long = 7,
    settings: JsonObject = SETTINGS,
    home: String? = null,
    away: String? = null,
    withAddresses: Boolean = false,
): JsonObject = buildJsonObject {
    put("device_id", deviceId)
    put("device_token", DEVICE_TOKEN)
    put("settings", settings)
    if (withAddresses || home != null) put("home_url", home)
    if (withAddresses || away != null) put("away_url", away)
}

/** Writes a credential straight into storage (the Expo tests' `paired: true`). */
suspend fun MemoryStore.pairedWith(
    baseUrl: String = "https://mw.example.net",
    homeUrl: String? = null,
    awayUrl: String? = null,
    instanceId: String? = null,
    token: String = DEVICE_TOKEN,
) {
    val c = app.milewage.core.pairing.Credential(baseUrl, homeUrl, awayUrl, 7, token, instanceId)
    put("pairing.credential", ApiJson.encodeToString(app.milewage.core.pairing.Credential.serializer(), c))
}
