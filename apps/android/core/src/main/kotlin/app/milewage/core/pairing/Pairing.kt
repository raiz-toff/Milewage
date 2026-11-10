package app.milewage.core.pairing

import app.milewage.core.api.Api
import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiHooks
import app.milewage.core.api.ApiJson
import app.milewage.core.api.DevicePlatform
import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.LinkPoll
import app.milewage.core.api.LinkRequestCreate
import app.milewage.core.api.MileWageHeaders
import app.milewage.core.api.Paired
import app.milewage.core.api.RedeemRequest
import app.milewage.core.api.Settings
import app.milewage.core.connect.Addresses
import app.milewage.core.connect.RoutePicker
import app.milewage.core.connect.ServerIdentity
import app.milewage.core.connect.Where
import app.milewage.core.net.HomeAddress
import app.milewage.core.ports.Clock
import app.milewage.core.ports.SecretStore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationException

/**
 * What the app start gate reads (24 section 4.1). [REVOKED]: the server refused this phone
 * (`device_revoked`); the credential is kept, but the phone must connect again.
 */
enum class PairingStatus { PAIRED, UNPAIRED, REVOKED }

/** A started link (plan 28 section 4.4): the phone shows [userCode]; [deviceCode] is its polling secret. */
data class LinkStart(
    val deviceCode: String,
    /** Six digits, shown on the phone and typed on the web. */
    val userCode: String,
    val expiresAtMs: Long,
    /** How long to wait between polls (RFC 8628 `interval`). */
    val intervalMs: Long,
)

/** An authenticated client for the paired server and the flags from the cached settings. */
class DeviceClient(
    val client: ApiClient,
    val flags: Flags,
    val credential: Credential,
)

class PairingDeps(
    /** The credential (Keystore-backed on the phone). */
    val secure: SecretStore,
    /** Settings cache, setup flag, stored revoke. */
    val plain: KeyValueStore,
    val transport: HttpTransport,
    val clock: Clock,
    /** The version sent at pairing (`app_version`, at most 32 characters). */
    val appVersion: String,
    val deviceName: String = "Android phone",
    /** Home or away for every request (plan 28); without it, the credential's `baseUrl` is used. */
    val route: RoutePicker? = null,
    /** Plain http to any address (debug builds); otherwise only to home addresses. */
    val anyHttp: Boolean = false,
    /** Holds every halt of sending. Default: its own, over [plain]. */
    val device: DeviceSession? = null,
    /** Called with the settings whenever they are stored or loaded (feeds the diagnostics level). */
    val onSettings: suspend (Settings) -> Unit = {},
    /**
     * Sees every answer of the device client from the paired server (after the wrong-server check),
     * with the instance it was paired with: the sending task's restore-generation check goes here.
     */
    val onAnswer: suspend (ServerIdentity, expectedInstance: String?) -> Unit = { _, _ -> },
)

/**
 * Pairing this phone with a server and the device session that follows (a port of the Expo app's
 * `pairing/pairing.ts`): redeeming a pairing code (QR, `milewage://` link, https page link), linking
 * with a six-digit code on the home Wi-Fi, keeping the credential in the [SecretStore], re-pairing
 * after a revoke or to another server, and unpairing.
 */
class Pairing(private val d: PairingDeps) {
    /** The device session: the halt every sender obeys. Pairing again lifts it. */
    val device: DeviceSession = d.device ?: DeviceSession(d.plain)
    private val listeners = Listeners()

    init {
        // A revoke (or any halt) is a pairing change for the app start gate, again on each refusal:
        // the gate may have waited for a running shift to end.
        device.subscribe { listeners.fire() }
    }

    /** Called after every pairing change (paired, unpaired, revoked, setup done). Returns the unsubscribe. */
    fun subscribe(listener: () -> Unit): () -> Unit = listeners.add(listener)

    /** The status now and after every change. */
    fun statusFlow(): Flow<PairingStatus> = callbackFlow {
        val off = subscribe { trySend(Unit) }
        send(Unit)
        awaitClose(off)
    }.conflate().map { status() }

    suspend fun status(): PairingStatus {
        if (loadCredential() == null) return PairingStatus.UNPAIRED
        return if (device.halted() == HaltReason.REPAIR) PairingStatus.REVOKED else PairingStatus.PAIRED
    }

    /** True from a first connection until the driver finishes the setup steps. */
    suspend fun setupPending(): Boolean = d.plain.get(KEY_SETUP) == "1"

    suspend fun finishSetup() {
        d.plain.remove(KEY_SETUP)
        listeners.fire()
    }

    /** Where requests go now (plan 28): home, away, or null before the first one. */
    val where: Where? get() = d.route?.where

    /**
     * Where to redeem a code: its home address when the phone is on Wi-Fi and the home address
     * answers (plan 28: at home the phone never needs Tailscale), else the code's own address.
     */
    private suspend fun redeemAt(link: PairingLink): String {
        val home = link.homeUrl
        val route = d.route
        if (home == null || home == link.baseUrl || route == null) return link.baseUrl
        val picked = route.pick(Addresses(link.baseUrl, homeUrl = home, awayUrl = link.baseUrl, instanceId = null))
        route.forget() // a pick for a code is not one for the credential
        return picked.url
    }

    /**
     * Redeems a pairing code (`POST /pairing/redeem`); stores the credential securely and the settings
     * in the cache. Throws [ApiException]: `invalid_pairing_token`, `rate_limited`, `network`,
     * `not_milewage` (something answered without the MileWage header), `insecure_address`, ...
     */
    suspend fun redeem(link: PairingLink): PairedState {
        val first = status() != PairingStatus.PAIRED
        val used = redeemAt(link)
        var milewage = false // every MileWage answer carries X-MileWage-Api (15 section 9.4)
        val client = ApiClient(
            d.transport, { used }, d.clock, anyHttp = d.anyHttp,
            hooks = ApiHooks(onResponse = { milewage = it.has(MileWageHeaders.API) }),
        )
        val res = try {
            client.call(Api.redeem, RedeemRequest(link.token, d.deviceName, DevicePlatform.ANDROID, d.appVersion.take(32)))
        } catch (e: ApiException) {
            if (e.status > 0 && !milewage) throw ApiException(e.status, ApiCodes.NOT_MILEWAGE, false)
            throw e
        }
        return keep(used, link.homeUrl, res.data, res.status, res.headers, first)
    }

    /**
     * Linking with a code (plan 28 section 4.4): asks the server found on the Wi-Fi; the phone shows
     * `userCode` and the driver types it on the web. Throws [ApiException] (`bad_response` for an
     * answer without a six-digit code).
     */
    suspend fun startLink(baseUrl: String): LinkStart {
        val res = plainClient(baseUrl).call(Api.startLink, LinkRequestCreate(d.deviceName, DevicePlatform.ANDROID))
        val s = res.data
        if (s.deviceCode.isEmpty() || !SIX_DIGITS.matches(s.userCode)) throw ApiException(res.status, ApiCodes.BAD_RESPONSE, false)
        fun seconds(v: Long?, fallback: Long) = if (v != null && v > 0 && v < 3600) v else fallback
        return LinkStart(
            deviceCode = s.deviceCode,
            userCode = s.userCode,
            expiresAtMs = d.clock.nowMs() + seconds(s.expiresIn, 600) * 1000,
            intervalMs = maxOf(1000, seconds(s.interval, 5) * 1000),
        )
    }

    /**
     * One poll: null while the driver has not typed the code; the new connection once they have.
     * Throws `link_expired` (expired, refused or used) and `slow_down` like any refusal.
     */
    suspend fun pollLink(baseUrl: String, deviceCode: String): PairedState? {
        val first = status() != PairingStatus.PAIRED
        val res = plainClient(baseUrl).call(Api.pollLink, LinkPoll(deviceCode))
        val paired = res.body ?: return null
        return keep(baseUrl, null, paired, res.status, res.headers, first)
    }

    /**
     * Polls until the driver types the code (every `intervalMs`, 5 s more after each `slow_down`,
     * RFC 8628 section 3.5) or the code expires (`link_expired`). Cancel the coroutine to stop.
     */
    suspend fun awaitLink(baseUrl: String, start: LinkStart): PairedState {
        var interval = start.intervalMs
        while (true) {
            delay(interval)
            if (d.clock.nowMs() >= start.expiresAtMs) throw ApiException(410, ApiCodes.LINK_EXPIRED, false)
            try {
                pollLink(baseUrl, start.deviceCode)?.let { return it }
            } catch (e: ApiException) {
                when {
                    e.code == ApiCodes.SLOW_DOWN -> interval += 5_000
                    e.retryable -> Unit // the Wi-Fi blinked: try again on the next tick
                    else -> throw e
                }
            }
        }
    }

    /**
     * Stores what a redeem (or a link, plan 28) answered. Home: the address used when it is a home
     * address, else the code's `h`, else the server's `home_url`. Away: the address used when it is not
     * a home address, else the server's `away_url`. The server's values are checked: home must be a
     * home address and away https outside it, so an answer cannot lower the rules.
     */
    private suspend fun keep(
        used: String,
        codeHome: String?,
        data: Paired,
        status: Int,
        headers: HttpHeaders,
        first: Boolean,
    ): PairedState {
        if (!DEVICE_TOKEN.containsMatchIn(data.deviceToken)) throw ApiException(status, ApiCodes.BAD_RESPONSE, false)
        fun tidy(v: String?) = v?.takeIf { PairingLinks.ADDRESS.matches(it) }?.trimEnd('/')
        val serverHome = tidy(data.homeUrl)
        val serverAway = tidy(data.awayUrl)
        val usedHome = HomeAddress.isHomeAddress(used)
        val credential = Credential(
            baseUrl = used,
            homeUrl = if (usedHome) used else codeHome ?: serverHome?.takeIf { HomeAddress.isHomeAddress(it) },
            awayUrl = if (!usedHome) {
                used
            } else {
                serverAway?.takeIf { it.startsWith("https:", ignoreCase = true) && !HomeAddress.isHomeAddress(it) }
            },
            deviceId = data.deviceId,
            deviceToken = data.deviceToken,
            instanceId = headers[MileWageHeaders.INSTANCE]?.takeIf { it.isNotEmpty() },
        )
        d.secure.put(KEY_CREDENTIAL, ApiJson.encodeToString(Credential.serializer(), credential))
        d.plain.put(KEY_SETTINGS, ApiJson.encodeToString(Settings.serializer(), data.settings))
        if (first) d.plain.put(KEY_SETUP, "1")
        d.onSettings(data.settings)
        // A new credential: every halt is lifted at once, so every sender goes again (queued shift
        // creates and ends, points, the change feed), and a wrong-server block is cleared. The
        // session's resume is this pairing change for the listeners.
        device.resume()
        return PairedState(credential, data.settings)
    }

    /** The server answered at a new home address on the Wi-Fi (same instance): keep it. */
    suspend fun updateHome(url: String) {
        val c = loadCredential() ?: return
        if (!HomeAddress.isHomeAddress(url)) return
        d.secure.put(KEY_CREDENTIAL, ApiJson.encodeToString(Credential.serializer(), c.copy(homeUrl = url.trimEnd('/'))))
    }

    /** Settings that arrived through the change feed replace the cached copy (and drive the flags). */
    suspend fun storeSettings(settings: Settings) {
        d.plain.put(KEY_SETTINGS, ApiJson.encodeToString(Settings.serializer(), settings))
        d.onSettings(settings)
    }

    suspend fun load(): PairedState? {
        val credential = loadCredential() ?: return null
        val settings = d.plain.get(KEY_SETTINGS)?.let {
            try {
                ApiJson.decodeFromString(Settings.serializer(), it)
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        }
        return PairedState(credential, settings)
    }

    /** The stored credential; null when there is none or it cannot be read (the phone pairs again). */
    private suspend fun loadCredential(): Credential? {
        val raw = d.secure.get(KEY_CREDENTIAL) ?: return null
        return try {
            ApiJson.decodeFromString(Credential.serializer(), raw)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /**
     * `GET /settings` at app start and after each send. On failure the cache stays and the error is
     * returned for the caller to show; a revoke halts the device session (08 section 4.3).
     */
    suspend fun refreshSettings(state: PairedState): Pair<PairedState, ApiException?> {
        val client = clientFor(state.credential)
        return try {
            val settings = client.call(Api.settings).data
            d.plain.put(KEY_SETTINGS, ApiJson.encodeToString(Settings.serializer(), settings))
            d.onSettings(settings)
            state.copy(settings = settings) to null
        } catch (e: ApiException) {
            state to e
        }
    }

    /** An authenticated client plus the flags from the cached settings; null when not paired. */
    suspend fun session(): DeviceClient? {
        val state = load() ?: return null
        return DeviceClient(clientFor(state.credential), Flags.of(state.settings), state.credential)
    }

    /**
     * Forgets the credential, the cached settings and the setup flag, and lifts every halt. Refused
     * (returns false, nothing changes) while [waiting] says unsent data would be lost: the caller
     * shows the blocking unpair (decision 2026-11-04, 1.5d) and passes `{ false }` to go ahead.
     */
    suspend fun unpair(waiting: suspend () -> Boolean = { false }): Boolean {
        if (waiting()) return false
        d.secure.remove(KEY_CREDENTIAL)
        d.plain.remove(KEY_SETTINGS)
        d.plain.remove(KEY_SETUP)
        device.resume() // nothing is halted for no pairing; tells the listeners
        return true
    }

    /** For the calls before pairing: no token, no route, no halts. */
    private fun plainClient(baseUrl: String) = ApiClient(d.transport, { baseUrl }, d.clock, anyHttp = d.anyHttp)

    private fun clientFor(c: Credential): ApiClient {
        val route = d.route
        return ApiClient(
            transport = d.transport,
            baseUrl = { route?.pick(c.addresses)?.url ?: c.baseUrl },
            clock = d.clock,
            token = c.deviceToken,
            anyHttp = d.anyHttp,
            hooks = ApiHooks(
                blocked = device::blocked,
                onUnreachable = { route?.forget() },
                onResponse = { headers ->
                    // Identity on every answer (15 section 9.4): another server at this address stops
                    // every request; all data stays.
                    if (ServerIdentity.isWrongServer(headers, c.instanceId)) {
                        device.halt(HaltReason.WRONG_SERVER)
                    } else {
                        d.onAnswer(ServerIdentity.of(headers), c.instanceId)
                    }
                },
                // Revoked or refused: the device session stops every sender. Nothing is deleted.
                onProblem = { e -> DeviceSession.haltFor(e)?.let { device.halt(it) } },
            ),
        )
    }

    companion object {
        /** Where the credential is kept in the [SecretStore] (the Expo app's key). */
        const val KEY_CREDENTIAL = "pairing.credential"

        /** The cached `GET /settings` in the plain store. */
        const val KEY_SETTINGS = "pairing.settings"

        /** Set when a phone connects from the first-run screens: the setup steps (24 section 4.2) follow. */
        const val KEY_SETUP = "pairing.setup"

        private val SIX_DIGITS = Regex("^[0-9]{6}$")
        private val DEVICE_TOKEN = Regex("^mwd_")
    }
}
