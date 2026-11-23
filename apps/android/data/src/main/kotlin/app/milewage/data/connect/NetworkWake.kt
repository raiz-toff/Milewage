package app.milewage.data.connect

import app.milewage.core.ports.Clock

/**
 * When to wake sending because of the network, with no Android types so it is tested on the JVM.
 *
 * A network that has just joined (`onAvailable`) is often not usable yet: Wi-Fi has associated, but
 * DNS, ARP or the router's first answers are not ready, so a round started at that instant fails and
 * the banner says offline. So there are two wakes: one when a network appears (debounced, since a
 * phone can flap), and one when Android has validated it (`NET_CAPABILITY_VALIDATED`), which is the
 * moment traffic really flows. The validated wake is once per network: it is the one that matters
 * and is never swallowed by the debounce of the first.
 */
class NetworkWake(
    private val clock: Clock,
    private val wake: () -> Unit,
    private val debounceMs: Long = DEBOUNCE_MS,
) {
    private val validated = HashSet<Long>()
    private var lastAvailableAt = Long.MIN_VALUE

    /** A network appeared. */
    @Synchronized
    fun onAvailable(id: Long) {
        val now = clock.nowMs()
        if (lastAvailableAt != Long.MIN_VALUE && now - lastAvailableAt < debounceMs) return
        lastAvailableAt = now
        wake()
    }

    /** A network's capabilities changed: wake the first time it is validated. */
    fun onCapabilities(id: Long, isValidated: Boolean) {
        val first = synchronized(this) { if (isValidated) validated.add(id) else { validated.remove(id); false } }
        if (first) wake()
    }

    @Synchronized
    fun onLost(id: Long) {
        validated.remove(id)
    }

    companion object {
        const val DEBOUNCE_MS = 1_000L
    }
}
