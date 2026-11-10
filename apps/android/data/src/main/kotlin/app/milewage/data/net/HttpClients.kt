package app.milewage.data.net

import app.milewage.core.net.HomeAddress
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The one HTTP client the app uses. Android's network security config cannot list address ranges,
 * so the app allows cleartext at the platform level (res/xml/network_security_config.xml) and
 * [HomeOnlyCleartext] is the gate: https everywhere, plain http only to a home address
 * (HomeAddress in :core, the same rule as the server and the web). Every request, redirects
 * included, passes it before a byte leaves the phone.
 */
object HttpClients {
    /** `anyHttp`: plain http to any address; debug builds only, for a server on a laptop. */
    fun create(anyHttp: Boolean): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(HomeOnlyCleartext(anyHttp))
        .addNetworkInterceptor(HomeOnlyCleartext(anyHttp))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** JSON as the server speaks it: unknown fields from a newer server are ignored. */
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
}

/** Refused before sending: plain http to an address outside the home network. */
class InsecureAddressException(url: String) :
    IOException("Plain http is only used on the home network; refused $url")

/** Application and network interceptor: the network position also sees each redirect hop. */
class HomeOnlyCleartext(private val anyHttp: Boolean) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val url = chain.request().url
        if (!anyHttp && !url.isHttps && !HomeAddress.httpAllowed(url.toString())) {
            throw InsecureAddressException("${url.scheme}://${url.host}")
        }
        return chain.proceed(chain.request())
    }
}
