package app.milewage.core.pairing

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/**
 * Why this phone may not send to its server right now (08 section 4.3, 15 section 9.4):
 * - [REPAIR]: the server revoked this phone (401 `device_revoked`). Kept across restarts; the app
 *   start gate asks to connect again.
 * - [WRONG_SERVER]: the address answers as another MileWage server than the one paired with.
 * - [AUTH_PROBLEM]: any other 401 or 403.
 */
enum class HaltReason { REPAIR, WRONG_SERVER, AUTH_PROBLEM }

/**
 * The device session's halt: the one holder of "stop sending" for every sender on the phone (the
 * outbox runner, the upload worker, the change puller, the restore resend). The device client records
 * a halt from the server's answers; pairing again (a code, a link) and the driver's "Send now" or
 * "Check the address" call [resume], which lifts every halt at once. A port of the Expo app's
 * `pairing/deviceSession.ts`.
 */
class DeviceSession(private val plain: KeyValueStore) {
    private data class Halts(val revoked: Boolean = false, val wrongServer: Boolean = false, val authProblem: Boolean = false)

    private val state = MutableStateFlow(Halts())
    private val listeners = Listeners()

    /** Why sending is stopped, most serious first; null when it is not. */
    suspend fun halted(): HaltReason? {
        val s = state.value
        if (s.revoked || plain.get(KEY_REVOKED) != null) return HaltReason.REPAIR
        if (s.wrongServer) return HaltReason.WRONG_SERVER
        return if (s.authProblem) HaltReason.AUTH_PROBLEM else null
    }

    /** True while no request may leave at all (another server answers at this address). */
    fun blocked(): Boolean = state.value.wrongServer

    /** Stops every sender. Takes effect at once; a revoke is also stored. Listeners hear each one. */
    suspend fun halt(reason: HaltReason) {
        state.update {
            when (reason) {
                HaltReason.REPAIR -> it.copy(revoked = true)
                HaltReason.WRONG_SERVER -> it.copy(wrongServer = true)
                HaltReason.AUTH_PROBLEM -> it.copy(authProblem = true)
            }
        }
        try {
            if (reason == HaltReason.REPAIR && plain.get(KEY_REVOKED) == null) plain.put(KEY_REVOKED, "1")
        } finally {
            listeners.fire()
        }
    }

    /** Lifts every halt: senders go again on their next run. A server that still refuses halts again. */
    suspend fun resume() {
        state.value = Halts()
        try {
            plain.remove(KEY_REVOKED)
        } finally {
            listeners.fire()
        }
    }

    /** Called after every halt and resume. Returns the unsubscribe. */
    fun subscribe(listener: () -> Unit): () -> Unit = listeners.add(listener)

    companion object {
        /** The stored revoke (the Expo app's key). */
        const val KEY_REVOKED = "pairing.revoked"

        /** The halt a refusal from the server means, if any. The one place 401 and 403 are read. */
        fun haltFor(e: ApiException): HaltReason? {
            if (e.status != 401 && e.status != 403) return null
            return if (e.code == ApiCodes.DEVICE_REVOKED) HaltReason.REPAIR else HaltReason.AUTH_PROBLEM
        }
    }
}

/** A thread-safe list of change listeners. */
internal class Listeners {
    private val list = MutableStateFlow<List<() -> Unit>>(emptyList())

    fun add(listener: () -> Unit): () -> Unit {
        list.update { it + listener }
        return { list.update { l -> l - listener } }
    }

    fun fire() {
        for (l in list.value) l()
    }
}
