package app.milewage.core.connect

import app.milewage.core.api.ApiCodes
import app.milewage.core.net.HomeAddress

/**
 * Say which step is wrong instead of "Cannot reach the server" (plan 19 section 3.5). A port of the
 * Expo app's `connect/reach.ts`. The words belong to the screens (strings.xml, MileWage voice): each
 * case below carries the Expo app's English as its KDoc so the screens task can copy it.
 */
object Reach {
    private val HOST = Regex("""^https?://(\[[^\]]+\]|[^/:?#]+)""", RegexOption.IGNORE_CASE)

    private fun host(url: String): String? = HOST.find(url)?.groupValues?.get(1)?.lowercase()

    /** An address on a tailnet (`*.ts.net`), reached through Tailscale. */
    fun isTailnetAddress(url: String): Boolean = host(url)?.endsWith(".ts.net") == true

    /** Before connecting, with no network call: an address this phone can never use. */
    fun addressProblem(baseUrl: String, release: Boolean): AddressProblem? {
        val h = host(baseUrl) ?: ""
        if (h == "localhost" || h.startsWith("127.") || h == "[::1]") return AddressProblem.THIS_COMPUTER
        // Plain http only on the home network (owner decision 2026-11-08, plan 28).
        if (release && !HomeAddress.httpAllowed(baseUrl)) return AddressProblem.INSECURE_OUTSIDE_HOME
        return null
    }

    /**
     * When connecting failed with [code] (an ApiException code). [vpn] is read only for a network
     * failure to a `.ts.net` address.
     */
    fun explainFailure(code: String, baseUrl: String, vpn: Boolean?): ConnectFailure {
        // At home there is no Tailscale to blame (plan 28): say what a home address needs.
        if (code == ApiCodes.NETWORK && HomeAddress.isHomeAddress(baseUrl)) return ConnectFailure.HomeUnreachable(baseUrl)
        if (code == ApiCodes.NETWORK && isTailnetAddress(baseUrl)) {
            return when (vpn) {
                false -> ConnectFailure.TailscaleOff
                true -> ConnectFailure.TailnetNotAnswering
                null -> ConnectFailure.TailscaleUnknown
            }
        }
        return when (code) {
            ApiCodes.INVALID_PAIRING_TOKEN -> ConnectFailure.InvalidCode
            ApiCodes.RATE_LIMITED -> ConnectFailure.RateLimited
            ApiCodes.NOT_MILEWAGE -> ConnectFailure.NotMileWage
            ApiCodes.NETWORK -> ConnectFailure.Unreachable
            ApiCodes.INSECURE_ADDRESS -> ConnectFailure.InsecureAddress
            else -> ConnectFailure.Other
        }
    }
}

enum class AddressProblem {
    /**
     * "This code points at the computer that made it, not your server. Make the code from your
     * server's https address."
     */
    THIS_COMPUTER,

    /**
     * "This code uses an unsecured address (http) outside your home network. Open MileWage in your
     * browser at its https address, or at its address on your home Wi-Fi, and make a new code."
     */
    INSECURE_OUTSIDE_HOME,
}

/** Why connecting failed, for the Connect screen. [offerTailscale]: show "Open Tailscale". */
sealed class ConnectFailure(val offerTailscale: Boolean = false) {
    /**
     * "Can't reach your server at <address>. Check that this phone is on the same Wi-Fi as the
     * server and that the server is on."
     */
    data class HomeUnreachable(val address: String) : ConnectFailure()

    /** "Tailscale is off on this phone. Open Tailscale, connect, then try again." */
    data object TailscaleOff : ConnectFailure(offerTailscale = true)

    /**
     * "Your server is not answering through Tailscale. Check that the server is on and that the
     * phone and server are signed in to the same Tailscale account."
     */
    data object TailnetNotAnswering : ConnectFailure()

    /** "Can't reach your server. Is Tailscale connected on this phone?" */
    data object TailscaleUnknown : ConnectFailure(offerTailscale = true)

    /** "This code is not valid, has expired or was already used. Make a new one." */
    data object InvalidCode : ConnectFailure()

    /** "Too many attempts. Wait a few minutes and try again." */
    data object RateLimited : ConnectFailure()

    /** "That address answered, but it is not a MileWage server." */
    data object NotMileWage : ConnectFailure()

    /** "Cannot reach the server. Check the address and your connection." */
    data object Unreachable : ConnectFailure()

    /** "This address uses plain http outside your home network. Use its https address instead." */
    data object InsecureAddress : ConnectFailure()

    /** "Connecting failed. Check the address and try again." */
    data object Other : ConnectFailure()
}
