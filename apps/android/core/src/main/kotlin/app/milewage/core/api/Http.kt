package app.milewage.core.api

import kotlinx.serialization.json.Json

/**
 * The HTTP port: what the API client needs from the platform. `:data` implements it on OkHttp
 * (`OkHttpTransport`, with the home-only cleartext gate); tests use a fake. Everything above it (the
 * address choice, headers, errors, the models) is plain Kotlin and runs the same on every platform.
 */
fun interface HttpTransport {
    /**
     * Sends [request] and returns the answer, whatever its status. Throws [TransportFailure] when
     * there was no answer at all (no route, refused, timed out, refused by the cleartext gate).
     */
    suspend fun exchange(request: HttpRequest): HttpResponse
}

enum class HttpMethod { GET, POST, PUT, PATCH, DELETE }

class HttpRequest(
    val method: HttpMethod,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    /** JSON bytes, or null for no body. */
    val body: ByteArray? = null,
    /** Send [body] gzipped with `Content-Encoding: gzip` (point batches, diagnostics). */
    val gzip: Boolean = false,
    /** The whole call's deadline in milliseconds; null for the client's defaults. */
    val timeoutMs: Long? = null,
)

class HttpResponse(
    val status: Int,
    val headers: HttpHeaders,
    val body: ByteArray,
) {
    val ok: Boolean get() = status in 200..299
}

/** Response headers, looked up without regard to case (HTTP field names are case-insensitive). */
class HttpHeaders(values: Map<String, String>) {
    private val byName = values.mapKeys { it.key.lowercase() }

    operator fun get(name: String): String? = byName[name.lowercase()]

    fun has(name: String): Boolean = name.lowercase() in byName

    companion object {
        val NONE = HttpHeaders(emptyMap())
    }
}

/** No answer: the request may or may not have reached the server. */
sealed class TransportFailure(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** Nothing answered: no network, no route, connection refused, timed out, TLS failed. */
    class NoAnswer(message: String = "no answer", cause: Throwable? = null) : TransportFailure(message, cause)

    /** Refused before sending: plain http to an address outside the home network (a redirect, say). */
    class Insecure(message: String = "plain http outside the home network", cause: Throwable? = null) :
        TransportFailure(message, cause)
}

/** The headers every MileWage answer carries (apps/server/src/hooks.ts). */
object MileWageHeaders {
    /** The API major version, `1`. Its presence says "this is a MileWage server". */
    const val API = "X-MileWage-Api"
    const val SERVER = "X-MileWage-Server"
    const val INSTANCE = "X-MileWage-Instance"
    const val RESTORE_GEN = "X-MileWage-Restore-Gen"
    const val APPLIED = "X-MileWage-Applied"
    const val SERVER_TIME = "X-Server-Time"
    const val CLIENT_TIME = "X-Client-Time"
    const val RETRY_AFTER = "Retry-After"

    /** The API major this app speaks. */
    const val API_VERSION = "1"
}

/**
 * JSON as the server speaks it. Unknown fields from a newer server are ignored; a missing nullable
 * field reads as null (older servers lack the newer optional fields). On the way out a property
 * left at its default is not written, so optional members are sent only when set.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}
