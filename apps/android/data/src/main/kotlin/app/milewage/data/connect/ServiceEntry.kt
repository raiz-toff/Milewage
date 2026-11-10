package app.milewage.data.connect

import android.net.NetworkCapabilities
import app.milewage.core.connect.Announcement
import app.milewage.core.connect.NetTransport
import java.net.Inet4Address
import java.net.InetAddress

/**
 * One server found on the Wi-Fi, as the app reads it (plan 28 section 4.5): the name, one address
 * (IPv4 first: every home router hands those out), the port and the TXT record as text. A port of
 * the Expo app's `native/net-check` ServiceEntry.
 */
object ServiceEntry {
    fun of(name: String, addresses: List<InetAddress>, port: Int, attributes: Map<String, ByteArray?>): Announcement? {
        val address = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull()
        val host = address?.hostAddress?.substringBefore('%') ?: return null
        if (port <= 0) return null
        val txt = attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) ?: "" }
        return Announcement(name, host, port, txt)
    }
}

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
