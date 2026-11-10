package app.milewage.core.pairing

import app.milewage.core.net.HomeAddress

/**
 * The pairing code's link format (08 section 2.4, plan 24 Q1, plan 28), a port of
 * packages/shared/src/pairing-link.ts kept line for line (same tests), so the server that makes the
 * code, the web page a camera app opens and the phone that reads it agree.
 *
 * Two forms carry the same facts:
 * - the app link `milewage://pair?v=1&u=<server address>&t=<mwp_ code>[&h=<home address>]`, which
 *   opens the phone app;
 * - the page link `<server address>/pair#v=1&t=<mwp_ code>[&h=<home address>]`, which the QR shows.
 *   The phone reads it too; any other camera opens the server's pair page (the https fallback). The
 *   code is in the fragment, so no server log sees it, and the server address is the page's own.
 *
 * `u` is the address the server put in the code: its away address when it has one, else its home
 * address. `h` (plan 28) is the home address, present only when it differs from `u`.
 */
data class PairingLink(
    /** `u`: the server address in the code, without a trailing slash. */
    val baseUrl: String,
    /** `t`: the one-time pairing code, `mwp_` and base64url characters. */
    val token: String,
    /** `h`: the server on the home network. Only ever a home address; null when there is none. */
    val homeUrl: String? = null,
)

object PairingLinks {
    /** JavaScript's `\s` (Unicode white space and line terminators), which the TypeScript patterns use. */
    private const val WS = """\s   -     　﻿"""

    /** An http(s) address with no query or fragment, as the server answers its home and away ones. */
    val ADDRESS = Regex("""^https?://[^$WS/?#]+(:[0-9]+)?(/[^$WS?#]*)?$""")
    private val TOKEN = Regex("""^mwp_[A-Za-z0-9_-]{10,}$""")
    private val PAGE = Regex("""^(https?://[^$WS/?#]+(?:/[^$WS?#]*?)?)/pair/?#(.*)$""")
    private val APP = Regex("""^milewage://pair\?(.*)$""")

    private fun trim(address: String) = address.trimEnd('/')

    /** Both forms of one pairing code: the app link and the page link the QR shows. */
    fun links(link: PairingLink): Pair<String, String> {
        val base = trim(link.baseUrl)
        val home = link.homeUrl?.let(::trim) ?: ""
        val t = "t=${encodeUriComponent(link.token)}"
        val h = if (home.isNotEmpty() && home != base) "&h=${encodeUriComponent(home)}" else ""
        return "milewage://pair?v=1&u=${encodeUriComponent(base)}&$t$h" to "$base/pair#v=1&$t$h"
    }

    /**
     * Reads either form. Returns null for anything else, another version included, so a scan of a
     * stray QR does nothing. In the page form a `u` inside the fragment is overridden by the page's
     * own address. An `h` that is not a home address is dropped.
     */
    fun parse(text: String): PairingLink? {
        val trimmed = text.trim()
        val page = PAGE.matchEntire(trimmed)
        val query = if (page != null) {
            "${page.groupValues[2]}&u=${encodeUriComponent(page.groupValues[1])}"
        } else {
            APP.matchEntire(trimmed)?.groupValues?.get(1) ?: return null
        }
        val params = HashMap<String, String>()
        for (pair in query.split('&')) {
            val i = pair.indexOf('=')
            if (i < 0) return null
            params[pair.substring(0, i)] = decodeUriComponent(pair.substring(i + 1)) ?: return null
        }
        val u = params["u"]
        val t = params["t"]
        if (params["v"] != "1" || u.isNullOrEmpty() || t.isNullOrEmpty() || !TOKEN.matches(t) || !ADDRESS.matches(u)) {
            return null
        }
        val h = params["h"]
        val home = if (!h.isNullOrEmpty() && ADDRESS.matches(h) && HomeAddress.isHomeAddress(h)) trim(h) else null
        return PairingLink(baseUrl = trim(u), token = t, homeUrl = home)
    }

    /** JavaScript's `encodeURIComponent`: keeps `A-Z a-z 0-9 - _ . ! ~ * ' ( )`, UTF-8 for the rest. */
    fun encodeUriComponent(value: String): String = buildString {
        for (b in value.encodeToByteArray()) {
            val c = b.toInt() and 0xff
            val ch = c.toChar()
            if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-_.!~*'()") {
                append(ch)
            } else {
                append('%')
                append(HEX[c shr 4])
                append(HEX[c and 0xf])
            }
        }
    }

    /** JavaScript's `decodeURIComponent`, or null where it would throw (bad escapes, bad UTF-8). */
    fun decodeUriComponent(value: String): String? {
        if ('%' !in value) return value
        val out = StringBuilder()
        var i = 0
        while (i < value.length) {
            if (value[i] != '%') {
                out.append(value[i])
                i++
                continue
            }
            val bytes = ArrayList<Byte>()
            while (i < value.length && value[i] == '%') {
                if (i + 3 > value.length) return null
                val hex = value.substring(i + 1, i + 3)
                val n = hex.toIntOrNull(16) ?: return null
                if (hex.any { it == '+' || it == '-' }) return null
                bytes += n.toByte()
                i += 3
            }
            val text = try {
                bytes.toByteArray().decodeToString(throwOnInvalidSequence = true)
            } catch (_: CharacterCodingException) {
                return null
            }
            out.append(text)
        }
        return out.toString()
    }

    private const val HEX = "0123456789ABCDEF"
}
