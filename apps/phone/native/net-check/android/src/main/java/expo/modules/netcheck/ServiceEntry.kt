package expo.modules.netcheck

import java.net.Inet4Address
import java.net.InetAddress

/**
 * One server found on the Wi-Fi, as the app reads it (plan 28 section 4.5): the name, one address
 * (IPv4 first: every home router hands those out), the port and the TXT record as text.
 */
object ServiceEntry {
  fun of(
    name: String,
    addresses: List<InetAddress>,
    port: Int,
    attributes: Map<String, ByteArray?>,
  ): Map<String, Any?>? {
    val address = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull()
    val host = address?.hostAddress?.substringBefore('%') ?: return null
    if (port <= 0) return null
    val txt = attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) ?: "" }
    return mapOf("name" to name, "host" to host, "port" to port, "txt" to txt)
  }
}
