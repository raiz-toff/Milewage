package app.milewage.data.net

import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpMethod
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.TransportFailure
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import okio.GzipSink
import okio.buffer
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The [HttpTransport] port on OkHttp. Use it with [HttpClients.create], whose [HomeOnlyCleartext]
 * interceptor refuses plain http to anything that is not a home address, redirects included.
 * Asynchronous (OkHttp's dispatcher threads) and cancellable: cancelling the coroutine cancels the
 * call. No answer at all becomes [TransportFailure]; any status is an answer.
 */
class OkHttpTransport(private val client: OkHttpClient) : HttpTransport {
    override suspend fun exchange(request: HttpRequest): HttpResponse {
        val payload = request.body?.let { if (request.gzip) gzip(it) else it }
        val body = payload?.toRequestBody(JSON)
            ?: if (request.method == HttpMethod.GET || request.method == HttpMethod.DELETE) null else ByteArray(0).toRequestBody(JSON)
        val builder = Request.Builder().url(request.url).method(request.method.name, body)
        for ((name, value) in request.headers) builder.header(name, value)
        if (request.gzip && payload != null) builder.header("Content-Encoding", "gzip")
        val call = try {
            client.newCall(builder.build())
        } catch (e: IllegalArgumentException) {
            throw TransportFailure.NoAnswer("not an address", e) // a malformed URL never reaches a server
        }
        request.timeoutMs?.let { call.timeout().timeout(it, TimeUnit.MILLISECONDS) }
        return call.await()
    }

    private suspend fun Call.await(): HttpResponse = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    cont.resumeWithException(failure(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    val answer = try {
                        response.use { HttpResponse(it.code, headersOf(it), it.body.bytes()) }
                    } catch (e: IOException) {
                        cont.resumeWithException(failure(e)) // the answer broke off
                        return
                    }
                    cont.resume(answer)
                }
            },
        )
    }

    private companion object {
        val JSON = "application/json".toMediaType()

        fun failure(e: IOException): TransportFailure =
            if (e is InsecureAddressException) TransportFailure.Insecure(cause = e) else TransportFailure.NoAnswer(cause = e)

        fun headersOf(r: Response) = HttpHeaders(r.headers.names().associateWith { r.headers[it].orEmpty() })

        fun gzip(bytes: ByteArray): ByteArray {
            val out = Buffer()
            GzipSink(out).buffer().use { it.write(bytes) }
            return out.readByteArray()
        }
    }
}
