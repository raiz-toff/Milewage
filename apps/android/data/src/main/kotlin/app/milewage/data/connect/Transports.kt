package app.milewage.data.connect

import android.net.NetworkCapabilities
import app.milewage.core.connect.NetTransport

/** The transports of the active network, from Android's NetworkCapabilities; null with no network. */
object Transports {
    fun of(hasTransport: ((Int) -> Boolean)?): Set<NetTransport>? = hasTransport?.let { has ->
        buildSet {
            if (has(NetworkCapabilities.TRANSPORT_WIFI)) add(NetTransport.WIFI)
            if (has(NetworkCapabilities.TRANSPORT_ETHERNET)) add(NetTransport.ETHERNET)
            if (has(NetworkCapabilities.TRANSPORT_CELLULAR)) add(NetTransport.CELLULAR)
            if (has(NetworkCapabilities.TRANSPORT_VPN)) add(NetTransport.VPN)
            if (has(NetworkCapabilities.TRANSPORT_BLUETOOTH)) add(NetTransport.BLUETOOTH)
            if (isEmpty()) add(NetTransport.OTHER)
        }
    }
}
