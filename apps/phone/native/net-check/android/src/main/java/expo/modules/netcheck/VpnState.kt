package expo.modules.netcheck

import android.net.NetworkCapabilities

/**
 * Whether this app's traffic goes through a VPN. Android gives a VPN network the transports of
 * the networks under it too (a VPN over Wi-Fi also has WIFI), so only TRANSPORT_VPN tells.
 * Null when there is no network to look at.
 */
object VpnState {
  fun of(hasTransport: ((Int) -> Boolean)?): Boolean? =
    hasTransport?.invoke(NetworkCapabilities.TRANSPORT_VPN)
}
