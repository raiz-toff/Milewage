package app.milewage.core.connect

import app.milewage.core.net.HomeAddress

/**
 * MileWage servers found on the Wi-Fi (plan 28 section 4.5). The server announces `_milewage._tcp`
 * over mDNS with TXT `v=1`, `id=<instance id>` and `path=/` (apps/server/src/lan/advertise.ts); the
 * phone browses with Android's NsdManager (`NsdDiscovery` in :data). Only home addresses are kept:
 * an announcement cannot point the phone at the internet, and http goes only to home addresses anyway.
 * A port of the Expo app's `connect/discover.ts`.
 */
object Discovery {
    /** The DNS-SD service type, as NsdManager takes it. */
    const val SERVICE_TYPE = "_milewage._tcp"

    /** How long the phone listens for announcements before showing what it found. */
    const val BROWSE_MS = 4_000L

    /** The servers in [announcements]: home addresses only, record version 1, each address once. */
    fun serversFrom(announcements: List<Announcement>): List<FoundServer> {
        val seen = HashSet<String>()
        val out = ArrayList<FoundServer>()
        for (a in announcements) {
            if ((a.txt["v"] ?: "1") != "1") continue // a later record version this app cannot read
            if (!HomeAddress.isHomeHost(a.host) || a.port !in 1..65535) continue
            val host = if (':' in a.host) "[${a.host}]" else a.host
            val url = "http://$host:${a.port}"
            if (!seen.add(url)) continue
            out += FoundServer(name = a.name.take(63), url = url, instanceId = a.txt["id"]?.takeIf { it.isNotEmpty() })
        }
        return out
    }
}

/** One resolved announcement: the name, one address (IPv4 first), the port and the TXT record as text. */
data class Announcement(
    val name: String,
    val host: String,
    val port: Int,
    val txt: Map<String, String>,
)

data class FoundServer(
    /** The announced name, e.g. "MileWage (box)". */
    val name: String,
    /** `http://<address>:<port>`, a home address. */
    val url: String,
    /** The server's instance id; null before its owner account exists. */
    val instanceId: String?,
)
