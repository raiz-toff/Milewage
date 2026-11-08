package expo.modules.netcheck

import android.net.NetworkCapabilities

/**
 * Whether the phone is on a network where the home address can answer (plan 28 section 4.3):
 * Wi-Fi or Ethernet, also under a VPN (Android gives a VPN network the transports of the network
 * under it). False on mobile data alone: then only the away address is tried. Null with no network.
 */
object LocalNetwork {
  fun of(hasTransport: ((Int) -> Boolean)?): Boolean? =
    hasTransport?.let {
      it(NetworkCapabilities.TRANSPORT_WIFI) || it(NetworkCapabilities.TRANSPORT_ETHERNET)
    }
}
