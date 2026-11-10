package app.milewage.phone.platform

import app.milewage.core.pairing.IncomingLinks
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Pairing links that open the app (`milewage://pair?...` from the web app's page or the phone's own
 * camera; an `https://<server>/pair#...` page link if one arrives). The activity hands every intent's
 * data here; each link is decided once with the pairing layer's [IncomingLinks] and waits in
 * [pending] until the shell acts on it: [LinkDecision.Ask] opens first run (the pairing task's
 * Connect screen takes it from there), the other two are a message.
 */
class PairLinkInbox(
    private val links: IncomingLinks = IncomingLinks(),
    private val status: suspend () -> PairingStatus,
) {
    private val _pending = MutableStateFlow<LinkDecision?>(null)
    val pending: StateFlow<LinkDecision?> = _pending.asStateFlow()
    private var lastHttps: String? = null

    suspend fun receive(url: String?) {
        val accepted = links.accept(url) ?: httpsPageLink(url) ?: return
        _pending.value = IncomingLinks.decide(accepted, status())
    }

    /** The shell acted on it (or the pairing screen took it). */
    fun consume() {
        _pending.value = null
    }

    /** `https://<server>/pair#v=1&t=...`, once per link (the start intent and a new-intent event). */
    @Synchronized
    private fun httpsPageLink(url: String?): String? {
        if (url == null || !url.startsWith("https://", ignoreCase = true) || "/pair" !in url || url == lastHttps) return null
        lastHttps = url
        return url
    }
}
