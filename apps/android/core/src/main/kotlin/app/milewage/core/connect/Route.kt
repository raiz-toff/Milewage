package app.milewage.core.connect

import app.milewage.core.api.HttpMethod
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.MileWageHeaders
import app.milewage.core.api.TransportFailure
import app.milewage.core.net.HomeAddress
import app.milewage.core.ports.Clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Home or away (plan 28 section 4.3). The phone keeps two addresses: the server on the home network
 * (http allowed) and the https one for everywhere else (Tailscale). It uses home when it is on Wi-Fi
 * or Ethernet and the home address answers quickly as the same server; otherwise away. No Wi-Fi name
 * and no location permission: reachability decides, as Plex and Immich's external list do. The choice
 * is remembered for a minute and forgotten when a request gets no answer. A port of the Expo app's
 * `connect/route.ts`, with three changes for the way home: a network change always drops the choice
 * ([RoutePicker.networkChanged]); a home probe that fails right after one gets two quick retries
 * before the phone settles on away (Wi-Fi has joined but DNS, ARP or the router's first answers are
 * not ready for a second or two); and an away pick made on Wi-Fi after the home address failed is
 * kept only briefly, so it cannot pin the phone away for a minute after the home network was fine.
 */
object RouteTimes {
    /** How long the home address has to answer `/healthz`. */
    const val PROBE_MS = 1_500L

    /** How long a choice is kept. */
    const val REMEMBER_MS = 60_000L

    /** How long an away pick is kept when the phone is on Wi-Fi and the home address did not answer. */
    const val REMEMBER_AWAY_ON_LAN_MS = 10_000L

    /** The waits before the quick retries of a home probe that failed just after a network change. */
    val RETRY_AFTER_MS = longArrayOf(1_500L, 3_000L)
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
    /** The wait between probes (virtual time in tests). */
    private val pause: suspend (Long) -> Unit = { delay(it) },
) {
    private class Memo(val key: String, val picked: Picked, val at: Long, val keptMs: Long)

    private val lock = Mutex()

    @Volatile
    private var memo: Memo? = null

    /** True until a home probe has had its quick retries: the first pick after start or a network change. */
    @Volatile
    private var settling = true

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
        memo?.let { if (it.key == key && now - it.at < it.keptMs) return it.picked }
        val local = localNetwork()
        val retry = settling
        var atHome = local != false && probe(home, instanceId)
        if (!atHome && local != false && retry) {
            for (wait in RouteTimes.RETRY_AFTER_MS) {
                pause(wait)
                if (localNetwork() == false) break // moved to mobile data meanwhile
                atHome = probe(home, instanceId)
                if (atHome) break
            }
        }
        if (local != false) settling = false
        val picked = if (atHome) Picked(home, Where.HOME) else Picked(away, Where.AWAY)
        val kept = if (!atHome && local != false) RouteTimes.REMEMBER_AWAY_ON_LAN_MS else RouteTimes.REMEMBER_MS
        memo = Memo(key, picked, clock.nowMs(), kept)
        return picked
    }

    /**
     * The phone's network changed (a network became usable, or the app came to the foreground): the
     * old choice says nothing about this network, so look again, with the quick retries.
     */
    fun networkChanged() {
        memo = null
        settling = true
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
