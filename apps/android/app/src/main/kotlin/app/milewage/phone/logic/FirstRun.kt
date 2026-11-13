package app.milewage.phone.logic

import app.milewage.core.demo.Demo
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiFailure
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
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

/** What the driver pasted or scanned on Connect. */
sealed interface ConnectInput {
    /** A pairing code (either link form): redeem it. */
    data class Code(val link: PairingLink) : ConnectInput

    /** An address this phone can never use; nothing is sent. */
    data class Refused(val problem: AddressProblem) : ConnectInput

    data object NotACode : ConnectInput

    companion object {
        /** [release]: plain http only to a home address (a debug build allows any, as the API client does). */
        fun read(text: String, release: Boolean): ConnectInput {
            val link = PairingLinks.parse(text.trim()) ?: return NotACode
            return Reach.addressProblem(link.baseUrl, release)?.let(::Refused) ?: Code(link)
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
    /** The demo server in this process ("Try it without a server"), not a server of the driver's. */
    val demo: Boolean = false,
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
                demo = Demo.isDemo(state.credential),
            )
        }
    }
}
