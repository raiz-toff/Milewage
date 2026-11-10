package app.milewage.phone.logic

import app.milewage.core.connect.Where
import app.milewage.core.pairing.Credential
import app.milewage.core.tracking.TrackingSettings

/* Settings' decisions in plain Kotlin: the connection check, the reminder choices, help links. */

/** Settings > Check connection. */
sealed interface ConnectionCheck {
    data object Checking : ConnectionCheck

    /** The server answered, at home or away. */
    data class Ok(val where: Where?) : ConnectionCheck

    data class Failed(val error: ConnectError) : ConnectionCheck
}

/** "Still on shift?" after this long without moving (TrackingSettings: 0 is off, else 10 min to 4 h). */
object NudgeChoices {
    private const val MINUTE = 60_000L

    val minutes: List<Int> = listOf(0, 15, 30, 45, 60, 90, 120)

    /** The choices, with the stored value too when it is none of them (set by an older build). */
    fun of(currentMs: Long): List<Int> {
        val current = (currentMs / MINUTE).toInt()
        return (minutes + current).distinct().sorted()
    }

    fun ms(minutes: Int): Long {
        val ms = minutes * MINUTE
        require(ms == 0L || ms in TrackingSettings.MIN_NUDGE_MS..TrackingSettings.MAX_NUDGE_MS)
        return ms
    }
}

/**
 * The server's own pages, opened in the phone's browser. Help is part of the web app and needs a
 * web session: the browser shows the sign-in page first, then the page. Through the address the
 * phone uses now (home on the Wi-Fi, else away), so it opens wherever sending works.
 */
object HelpLinks {
    enum class Page(val path: String) {
        INDEX("/help"),
        GETTING_STARTED("/help/getting-started"),
        PHONES("/help/phones-and-devices"),
        TROUBLESHOOTING("/help/troubleshooting"),
    }

    fun base(c: Credential, where: Where?): String {
        val (home, away) = c.addresses.homeAndAway()
        return when (where) {
            Where.HOME -> home ?: away ?: c.baseUrl
            Where.AWAY -> away ?: home ?: c.baseUrl
            null -> away ?: home ?: c.baseUrl
        }.trimEnd('/')
    }

    fun url(c: Credential, where: Where?, page: Page): String = base(c, where) + page.path
}

/** The address explained by a failed check: the one the phone used, or would use. */
fun Credential.checkedUrl(where: Where?): String = HelpLinks.base(this, where)
