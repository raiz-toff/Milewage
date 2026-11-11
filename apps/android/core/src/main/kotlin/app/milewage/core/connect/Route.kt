package app.milewage.core.connect

import app.milewage.core.api.HttpMethod
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.MileWageHeaders
import app.milewage.core.api.TransportFailure
import app.milewage.core.net.HomeAddress
import app.milewage.core.ports.Clock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Home or away (plan 28 section 4.3). The phone keeps two addresses: the server on the home network
 * (http allowed) and the https one for everywhere else (Tailscale). It uses home when it is on Wi-Fi
 * or Ethernet and the home address answers quickly as the same server; otherwise away. No Wi-Fi name
 * and no location permission: reachability decides, as Plex and Immich's external list do. The choice
 * is remembered for a minute and forgotten when a request gets no answer. A port of the Expo app's
 * `connect/route.ts`.
 */
object RouteTimes {
    /** How long the home address has to answer `/healthz`. */
    const val PROBE_MS = 1_500L

    /** How long a choice is kept. */
    const val REMEMBER_MS = 60_000L
}

/** A credential's addresses. A phone from before plan 28 has only [baseUrl]. */
data class Addresses(
    /** The address the phone connected through. */
    val baseUrl: String,
    val homeUrl: String? = null,
    val awayUrl: String? = null,
    val instanceId: String? = null,
) {
    /** Home and away, also of a credential saved before plan 28 (only [baseUrl]). */
    fun homeAndAway(): Pair<String?, String?> {
        val legacyHome = HomeAddress.isHomeAddress(baseUrl)
        return (homeUrl ?: if (legacyHome) baseUrl else null) to (awayUrl ?: if (legacyHome) null else baseUrl)
    }
}

enum class Where { HOME, AWAY }

data class Picked(val url: String, val where: Where)

class RoutePicker(
    /** True on Wi-Fi or Ethernet, false on mobile data alone, null when the phone cannot tell. */
    private val localNetwork: suspend () -> Boolean?,
    /** Whether `url` answers quickly as the server with this instance id (any, when null). */
    private val probe: suspend (url: String, instanceId: String?) -> Boolean,
    private val clock: Clock,
) {
    private class Memo(val key: String, val picked: Picked, val at: Long)

    private val lock = Mutex()
    private var memo: Memo? = null

    /** Where the last pick went (the banner says "away" things only when away); null before one. */
    var where: Where? = null
        private set

    suspend fun pick(c: Addresses): Picked {
        val (home, away) = c.homeAndAway()
        val chosen = lock.withLock { choose(home, away, c.instanceId) }
        where = chosen.where
        return chosen
    }

    private suspend fun choose(home: String?, away: String?, instanceId: String?): Picked {
        if (home == null) return Picked(requireNotNull(away) { "no address" }, Where.AWAY)
        if (away == null) return Picked(home, Where.HOME)
        val key = "$home $away"
        val now = clock.nowMs()
        memo?.let { if (it.key == key && now - it.at < RouteTimes.REMEMBER_MS) return it.picked }
        val local = localNetwork()
        val atHome = local != false && probe(home, instanceId)
        val picked = if (atHome) Picked(home, Where.HOME) else Picked(away, Where.AWAY)
        memo = Memo(key, picked, clock.nowMs())
        return picked
    }

    /** A request got no answer: look again next time (walking out of the house switches to away). */
    fun forget() {
        memo = null
    }
}

/**
 * `GET <url>/healthz` within [RouteTimes.PROBE_MS]: ok, a MileWage answer (`X-MileWage-Api`), and the
 * same instance (`X-MileWage-Instance`) when the phone knows it. A café Wi-Fi with something else at
 * the same private address fails, so the device token is never sent there.
 */
object HealthProbe {
    fun over(transport: HttpTransport, timeoutMs: Long = RouteTimes.PROBE_MS): suspend (String, String?) -> Boolean =
        { url, instanceId ->
            withTimeoutOrNull(timeoutMs) {
                try {
                    val res = transport.exchange(
                        HttpRequest(HttpMethod.GET, "${url.trimEnd('/')}/healthz", mapOf("Accept" to "application/json"), timeoutMs = timeoutMs),
                    )
                    res.ok && res.headers.has(MileWageHeaders.API) &&
                        (instanceId == null || res.headers[MileWageHeaders.INSTANCE] == instanceId)
                } catch (_: TransportFailure) {
                    false
                }
            } ?: false
        }
}
