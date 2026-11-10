package app.milewage.phone.logic

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiFailure
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.Reach
import app.milewage.core.net.HomeAddress
import app.milewage.core.pairing.PairedState
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.pairing.PairingStatus

/*
 * First run's decisions (24 section 4, plan 28), in plain Kotlin and tested on the JVM: which part of
 * the app shows, what the driver typed or scanned, and every failure as a type with its one way
 * forward. The words are in strings.xml (ui/Texts.kt maps them), from the Expo app's screens.
 */

/** Which part of the app shows. */
enum class Gate {
    LOADING,

    /** Not paired (or revoked): Welcome and the ways to connect. */
    FIRST_RUN,

    /** Connected from first run: Connected, the permissions, Ready, until the driver goes to Home. */
    SETUP,

    /** The app. */
    MAIN,
}

object Gates {
    /**
     * The app for a paired phone. A running shift keeps the app on screen whatever happens to the
     * pairing (a revoke mid-shift: the shift goes on recording, its data waits; a re-pair mid-shift:
     * the setup steps come after the shift). A first connection shows the setup steps first.
     */
    fun of(status: PairingStatus, running: Boolean, setupPending: Boolean): Gate = when {
        running -> Gate.MAIN
        status != PairingStatus.PAIRED -> Gate.FIRST_RUN
        setupPending -> Gate.SETUP
        else -> Gate.MAIN
    }
}

/** What the driver typed or pasted on Connect. */
sealed interface ConnectInput {
    /** A pairing code (either link form): redeem it. */
    data class Code(val link: PairingLink) : ConnectInput

    /** A server address: link this phone with a 6-digit code there. */
    data class Address(val url: String) : ConnectInput

    /** An address this phone can never use; nothing is sent. */
    data class Refused(val problem: AddressProblem) : ConnectInput

    data object NotACode : ConnectInput

    companion object {
        private val SCHEME = Regex("^https?://", RegexOption.IGNORE_CASE)

        /** [release]: plain http only to a home address (a debug build allows any, as the API client does). */
        fun read(text: String, release: Boolean): ConnectInput {
            val t = text.trim()
            PairingLinks.parse(t)?.let { link ->
                return Reach.addressProblem(link.baseUrl, release)?.let(::Refused) ?: Code(link)
            }
            val url = address(t) ?: return NotACode
            return Reach.addressProblem(url, release)?.let(::Refused) ?: Address(url)
        }

        /**
         * A typed server address as a base URL: `192.168.1.20:8080` and `box.local:8080` become http
         * (home addresses), `box.tail1234.ts.net` becomes https; a scheme typed is kept. Null for
         * anything that is not an address (a word, a stray code).
         */
        fun address(text: String): String? {
            val t = text.trim().trimEnd('/')
            if (t.isEmpty() || t.any(Char::isWhitespace) || t.startsWith("mwp_")) return null
            val url = if (SCHEME.containsMatchIn(t)) {
                t
            } else {
                val host = t.substringBefore('/').substringBefore(':').lowercase()
                if (HomeAddress.isHomeHost(host)) "http://$t" else "https://$t"
            }
            val host = HomeAddress.parts(url)?.host ?: return null
            // One label alone ("milewage") is not an address the phone can find; localhost is refused later.
            if ('.' !in host && ':' !in host && host != "localhost") return null
            return url.takeIf { PairingLinks.ADDRESS.matches(it) }
        }
    }
}

/** What went wrong on Connect, each with its one way forward ([fix]). */
sealed interface ConnectError {
    val fix: ConnectFix

    /** "That is not a MileWage pairing code." */
    data object NotACode : ConnectError {
        override val fix = ConnectFix.SCAN
    }

    data class Address(val problem: AddressProblem) : ConnectError {
        override val fix = ConnectFix.SCAN
    }

    /** `upgrade_required`: this app is older than the server. */
    data object AppTooOld : ConnectError {
        override val fix = ConnectFix.TRY_AGAIN
    }

    data class Failed(val failure: ConnectFailure) : ConnectError {
        override val fix: ConnectFix = when (failure) {
            ConnectFailure.TailscaleOff, ConnectFailure.TailscaleUnknown -> ConnectFix.OPEN_TAILSCALE
            ConnectFailure.InvalidCode, ConnectFailure.InsecureAddress -> ConnectFix.SCAN
            else -> ConnectFix.TRY_AGAIN
        }
    }

    companion object {
        /**
         * A failed connection in the driver's terms (`Reach.explainFailure`, plan 19 section 3.5).
         * [vpn] is asked only for a network failure to a `.ts.net` address.
         */
        suspend fun of(e: Throwable, baseUrl: String, vpn: suspend () -> Boolean?): ConnectError {
            val api = e as? ApiException ?: return Failed(ConnectFailure.Other)
            if (api.failure == ApiFailure.APP_TOO_OLD) return AppTooOld
            val v = if (api.code == ApiCodes.NETWORK && Reach.isTailnetAddress(baseUrl)) vpn() else null
            return Failed(Reach.explainFailure(api.code, baseUrl, v))
        }
    }
}

/** The button under a connect error. */
enum class ConnectFix { TRY_AGAIN, OPEN_TAILSCALE, SCAN }

/** The servers announced on this Wi-Fi (plan 28 section 4.5). */
sealed interface Nearby {
    data object Looking : Nearby

    data class Found(val servers: List<FoundServer>) : Nearby

    /** On mobile data: discovery cannot work. [tailscaleOff]: offer the Tailscale screen. */
    data class OffWifi(val tailscaleOff: Boolean) : Nearby

    /** Android 17 at targetSdk 37: local network access must be allowed first. */
    data object NeedsPermission : Nearby
}

/** Linking with a code failed (plan 28 section 4.4). */
enum class LinkFailure {
    /** "The code expired or was refused. Get a new code and try again." */
    EXPIRED,

    /** "Too many phones are waiting to link. Wait a minute and try again." */
    RATE_LIMITED,

    /** "Can't reach your server. Check that this phone is on the same Wi-Fi as the server." */
    UNREACHABLE,

    /** "This server cannot link phones with a code yet. Update it, or scan the code." */
    NOT_SUPPORTED,

    /** This app is older than the server. */
    APP_TOO_OLD,

    /** "Linking failed. Try again." */
    OTHER,
    ;

    companion object {
        fun of(e: Throwable): LinkFailure = when ((e as? ApiException)?.failure) {
            ApiFailure.LINK_EXPIRED -> EXPIRED
            ApiFailure.RATE_LIMITED -> RATE_LIMITED
            ApiFailure.UNREACHABLE -> UNREACHABLE
            ApiFailure.NOT_FOUND -> NOT_SUPPORTED
            ApiFailure.APP_TOO_OLD -> APP_TOO_OLD
            else -> OTHER
        }
    }
}

/** A scanned QR code: a pairing code to connect with, or something else to say no to. */
sealed interface ScanResult {
    data class Code(val text: String) : ScanResult

    data object Stray : ScanResult

    companion object {
        fun of(text: String): ScanResult = if (PairingLinks.parse(text.trim()) != null) Code(text.trim()) else Stray
    }
}

/** Host names only, for the screens (never a token, never a path). */
object Hosts {
    fun of(url: String?): String? = url?.let { HomeAddress.parts(it)?.host }
}

/** What the server sent when the phone connected (24 section 4.2, screen 5), and its two addresses. */
data class ServerFacts(
    /** The server this phone is paired with: its away host when it has one, else its home host. */
    val host: String,
    /** The driver's display name on the server. */
    val name: String?,
    val homeHost: String?,
    val awayHost: String?,
    /** ISO 3166 code. */
    val country: String?,
    val region: String?,
) {
    /** No away address: shifts are sent only from the home Wi-Fi (Tailscale later, optional). */
    val homeOnly: Boolean get() = awayHost == null

    companion object {
        fun of(state: PairedState): ServerFacts {
            val (home, away) = state.credential.addresses.homeAndAway()
            val homeHost = Hosts.of(home)
            val awayHost = Hosts.of(away)
            return ServerFacts(
                host = awayHost ?: homeHost ?: Hosts.of(state.credential.baseUrl) ?: state.credential.baseUrl,
                name = state.settings?.displayName?.takeIf { it.isNotBlank() },
                homeHost = homeHost,
                awayHost = awayHost,
                country = state.settings?.country?.takeIf { it.isNotBlank() },
                region = state.settings?.region?.takeIf { it.isNotBlank() },
            )
        }
    }
}
