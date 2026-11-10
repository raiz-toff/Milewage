package app.milewage.core.api

import app.milewage.core.net.HomeAddress
import app.milewage.core.ports.Clock
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/** A successful answer. [body] is null only for the endpoint's `emptyStatuses` (202 pending). */
class ApiResponse<T>(
    val status: Int,
    val body: T?,
    val headers: HttpHeaders,
) {
    /** The body; for statuses that always carry one. */
    val data: T get() = body ?: throw ApiException(status, ApiCodes.BAD_RESPONSE, false)
}

/**
 * What a client tells its owner about each request. All optional; the device session's client
 * uses every one (see `Pairing.session`).
 */
class ApiHooks(
    /** True stops every request before it is sent (another server answers at the address). */
    val blocked: () -> Boolean = { false },
    /** A request got no answer at all (the home/away choice is looked at again). */
    val onUnreachable: suspend () -> Unit = {},
    /** Sees the headers of every answer, ok or not (identity and restore checks). */
    val onResponse: suspend (HttpHeaders) -> Unit = {},
    /** Sees every refusal before it is thrown (a revoke halts the device session here). */
    val onProblem: suspend (ApiException) -> Unit = {},
)

/**
 * The JSON client for `/api/v1` (08), a port of the Expo app's `api/client.ts`. Plain Kotlin over
 * the [HttpTransport] port. It never logs: tokens and bodies stay out of every message it builds.
 *
 * Plain http goes only to a home address unless [anyHttp] (debug builds): the check runs here before
 * anything is built, and again in the OkHttp transport for every hop, redirects included.
 */
class ApiClient(
    private val transport: HttpTransport,
    /** The server, picked per request (home or away, plan 28). No trailing slash. */
    private val baseUrl: suspend () -> String,
    private val clock: Clock,
    /** Device bearer token; null for the calls before pairing. */
    private val token: String? = null,
    private val anyHttp: Boolean = false,
    private val hooks: ApiHooks = ApiHooks(),
) {
    /** One operation without a request body. */
    suspend fun <Res> call(
        endpoint: Endpoint<Unit, Res>,
        pathParams: Map<String, String> = emptyMap(),
        query: List<Pair<String, String>> = emptyList(),
    ): ApiResponse<Res> = decode(endpoint, raw(endpoint, endpoint.pathWith(pathParams), query, null))

    /** One operation with a request body. */
    suspend fun <Req, Res> call(
        endpoint: Endpoint<Req, Res>,
        body: Req,
        pathParams: Map<String, String> = emptyMap(),
    ): ApiResponse<Res> {
        val serializer = requireNotNull(endpoint.request) { "$endpoint takes no body" }
        val bytes = ApiJson.encodeToString(serializer, body).encodeToByteArray()
        return decode(endpoint, raw(endpoint, endpoint.pathWith(pathParams), emptyList(), bytes))
    }

    /**
     * A shift change as [ShiftRequests] built it (straight away or from the outbox). The answer is
     * left as JSON: the sender reads what it needs ([ShiftRequests.endpointOf] has its model).
     */
    suspend fun send(request: ShiftRequest): ApiResponse<JsonElement> {
        val endpoint = ShiftRequests.endpointOf(request.kind)
        val bytes = ApiJson.encodeToString(JsonObject.serializer(), request.body).encodeToByteArray()
        val res = exchange(request.method, request.path, emptyList(), bytes, endpoint.gzip, root = false)
        return ApiResponse(res.status, parseJson(res), res.headers)
    }

    private suspend fun raw(
        endpoint: Endpoint<*, *>,
        path: String,
        query: List<Pair<String, String>>,
        body: ByteArray?,
    ): HttpResponse = exchange(endpoint.method, path, query, body, endpoint.gzip, endpoint.root)

    private fun <Res> decode(endpoint: Endpoint<*, Res>, res: HttpResponse): ApiResponse<Res> {
        if (res.status in endpoint.emptyStatuses) return ApiResponse(res.status, null, res.headers)
        val body = try {
            ApiJson.decodeFromString(endpoint.response, res.body.decodeToString())
        } catch (_: SerializationException) {
            throw ApiException(res.status, ApiCodes.BAD_RESPONSE, false)
        } catch (_: IllegalArgumentException) {
            throw ApiException(res.status, ApiCodes.BAD_RESPONSE, false)
        }
        return ApiResponse(res.status, body, res.headers)
    }

    /** Sends one request; returns a 2xx answer or throws [ApiException]. */
    private suspend fun exchange(
        method: HttpMethod,
        path: String,
        query: List<Pair<String, String>>,
        body: ByteArray?,
        gzip: Boolean,
        root: Boolean,
    ): HttpResponse {
        // Retryable on purpose: queued data is kept and retried, nothing is sent while blocked.
        if (hooks.blocked()) throw ApiException(0, ApiCodes.WRONG_SERVER, true)
        val base = baseUrl().trimEnd('/')
        // Never sent: plain http outside the home network (owner decision 2026-11-08).
        if (!anyHttp && !HomeAddress.httpAllowed(base)) throw ApiException(0, ApiCodes.INSECURE_ADDRESS, false)
        val headers = buildMap {
            put("Accept", "application/json")
            put(MileWageHeaders.CLIENT_TIME, clock.nowMs().toString())
            token?.let { put("Authorization", "Bearer $it") }
            if (body != null) put("Content-Type", "application/json")
        }
        val q = if (query.isEmpty()) "" else query.joinToString("&", "?") { (k, v) -> "${percentEncode(k)}=${percentEncode(v)}" }
        val url = (if (root) base else "$base/api/v1") + path + q
        val res = try {
            transport.exchange(HttpRequest(method, url, headers, body, gzip && body != null))
        } catch (_: TransportFailure.Insecure) {
            throw ApiException(0, ApiCodes.INSECURE_ADDRESS, false)
        } catch (_: TransportFailure.NoAnswer) {
            hooks.onUnreachable()
            throw ApiException(0, ApiCodes.NETWORK, true)
        }
        hooks.onResponse(res.headers)
        val api = res.headers[MileWageHeaders.API]
        if (api != null && api.trim() != MileWageHeaders.API_VERSION) {
            fail(ApiException(res.status, ApiCodes.API_UNSUPPORTED, false))
        }
        if (res.ok) return res
        fail(problemOf(res))
    }

    private suspend fun fail(e: ApiException): Nothing {
        hooks.onProblem(e)
        throw e
    }

    companion object {
        /** The refusal an answer means: its Problem, read leniently, as the Expo client did. */
        fun problemOf(res: HttpResponse): ApiException {
            val json = parseJson(res) as? JsonObject
            val code = json?.get("code")?.let { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            val retryable = json?.get("retryable")?.let { runCatching { it.jsonPrimitive.booleanOrNull }.getOrNull() }
            val retryAfter = res.headers[MileWageHeaders.RETRY_AFTER]?.trim()?.toLongOrNull()?.takeIf { it > 0 }
            val problem = json?.let { runCatching { ApiJson.decodeFromJsonElement(Problem.serializer(), it) }.getOrNull() }
            return ApiException(
                status = res.status,
                code = code ?: "unknown",
                retryable = retryable ?: (res.status >= 500 || res.status == 429),
                retryAfterS = retryAfter,
                problem = problem,
            )
        }

        private fun parseJson(res: HttpResponse): JsonElement? {
            val text = res.body.decodeToString()
            if (text.isBlank()) return null
            return try {
                ApiJson.parseToJsonElement(text)
            } catch (_: SerializationException) {
                if (res.ok) throw ApiException(res.status, ApiCodes.BAD_RESPONSE, false)
                null
            }
        }

        /** Decodes [element] with [serializer], or throws bad_response. */
        fun <T> read(serializer: KSerializer<T>, element: JsonElement?, status: Int): T = try {
            ApiJson.decodeFromJsonElement(serializer, element ?: throw ApiException(status, ApiCodes.BAD_RESPONSE, false))
        } catch (_: SerializationException) {
            throw ApiException(status, ApiCodes.BAD_RESPONSE, false)
        } catch (_: IllegalArgumentException) {
            throw ApiException(status, ApiCodes.BAD_RESPONSE, false)
        }
    }
}
