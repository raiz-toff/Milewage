package app.milewage.core.net

/**
 * Home addresses (plan 28 section 4.1, owner decision 2026-11-08): the only places the phone may use
 * plain http. Private IPv4 (RFC 1918), IPv4 link-local, IPv6 unique local (fc00::/7) and link-local
 * (fe80::/10), and the names `*.local` (RFC 6762), `*.lan` and `*.home.arpa` (RFC 8375).
 * `localhost` and loopback are not home addresses: they are "this computer".
 *
 * A port of packages/shared/src/home-address.ts, kept line for line so the phone, the server and
 * the web agree. Android's network security config cannot express address ranges, so the platform
 * allows cleartext and this rule is the gate (the API client refuses http elsewhere).
 */
object HomeAddress {
    enum class Scheme { HTTP, HTTPS }

    data class Parts(val scheme: Scheme, val host: String)

    private val ADDRESS =
        Regex("""^(https?)://(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#]|$)""", RegexOption.IGNORE_CASE)
    private val IPV4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")
    private val MAPPED_V4 = Regex("""^::ffff:([\d.]+)$""")
    private val IPV6_CHARS = Regex("""^[0-9a-f:.]+$""")
    private val NAME = Regex("""^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$""")
    private val HOME_SUFFIX = Regex("""\.(local|lan|home\.arpa)$""")

    /** The scheme and host of an http(s) address (IPv6 without brackets, lower case), or null. */
    fun parts(url: String): Parts? {
        val m = ADDRESS.find(url.trim()) ?: return null
        val host = m.groupValues[2].lowercase().removePrefix("[").removeSuffix("]")
        val scheme = if (m.groupValues[1].equals("https", ignoreCase = true)) Scheme.HTTPS else Scheme.HTTP
        return Parts(scheme, host)
    }

    private fun ipv4(host: String): List<Int>? {
        val m = IPV4.matchEntire(host) ?: return null
        val parts = m.groupValues.drop(1).map { it.toInt() }
        return if (parts.all { it <= 255 }) parts else null
    }

    /** True for a host on the home network (see above); false for anything else, loopback included. */
    fun isHomeHost(host: String): Boolean {
        val h = host.trim().lowercase()
            .removePrefix("[").removeSuffix("]")
            .replace(Regex("%.*$"), "") // IPv6 zone id
            .removeSuffix(".") // a fully qualified name may end in a dot
        val v4 = ipv4(h) ?: ipv4(MAPPED_V4.matchEntire(h)?.groupValues?.get(1) ?: "")
        if (v4 != null) {
            val (a, b) = v4
            return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        if (':' in h) {
            if (!IPV6_CHARS.matches(h)) return false
            val first = if (h.startsWith(':')) 0 else leadingHex16(h.substringBefore(':'))
            return (first and 0xfe00) == 0xfc00 || (first and 0xffc0) == 0xfe80
        }
        return NAME.matches(h) && HOME_SUFFIX.containsMatchIn(h)
    }

    /** The low 16 bits of JavaScript's `parseInt(group, 16)` (0 where it would be NaN). */
    private fun leadingHex16(group: String): Int {
        val hex = group.takeWhile { it in '0'..'9' || it in 'a'..'f' }
        return if (hex.isEmpty()) 0 else hex.takeLast(4).toInt(16)
    }

    /** An http(s) address whose host is on the home network. */
    fun isHomeAddress(url: String): Boolean = parts(url)?.let { isHomeHost(it.host) } ?: false

    /** https always; plain http only to a home address (owner decision 2026-11-08). */
    fun httpAllowed(url: String): Boolean {
        val p = parts(url) ?: return false
        return p.scheme == Scheme.HTTPS || isHomeHost(p.host)
    }
}
