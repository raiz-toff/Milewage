package app.milewage.core.pairing

/**
 * `milewage://` links that open the app: the one that started it and any that arrive while it runs
 * (the phone's own camera scanning the pairing QR, or a tap on the link on the web page). A port of
 * the Expo app's `PairingLinks.tsx` without the UI: the activity hands each intent's data here.
 */
class IncomingLinks {
    private var last: String? = null

    /**
     * The link to act on, or null: not a `milewage://` link, or the same link delivered twice (the
     * start-up intent and a new-intent event) which is handled once.
     */
    @Synchronized
    fun accept(url: String?): String? {
        if (url == null || !url.startsWith("milewage://", ignoreCase = true) || url == last) return null
        last = url
        return url
    }

    companion object {
        /** What to do with a pairing code that arrived from outside (a link, a scan), given the status. */
        fun decide(text: String, status: PairingStatus): LinkDecision {
            val link = PairingLinks.parse(text) ?: return LinkDecision.NotAPairingCode
            // An already paired phone says so instead of switching servers (Settings disconnects first).
            if (status == PairingStatus.PAIRED) return LinkDecision.AlreadyConnected
            return LinkDecision.Ask(link)
        }
    }
}

sealed interface LinkDecision {
    /** "That is not a MileWage pairing code." */
    data object NotAPairingCode : LinkDecision

    /** "This phone is already connected." */
    data object AlreadyConnected : LinkDecision

    /** "Connect to this server?" with [link]'s address; Yes redeems it, Cancel sends nothing. */
    data class Ask(val link: PairingLink) : LinkDecision
}
