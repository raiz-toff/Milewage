package app.milewage.core.sync

import app.milewage.core.api.ChangeType
import app.milewage.core.connect.ServerIdentity
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.SendState
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The restore-generation check on every answer of the paired server (15 section 9.3), a port of
 * the generation half of the Expo app's `sync/connection.ts` (the wrong-server half is in
 * `Pairing`). Plug [observe] into `PairingDeps.onAnswer` (`ServerConnection(onAnswer = ...)`).
 *
 * A higher `X-MileWage-Restore-Gen` than the one stored means the server was restored from a backup:
 * every shift the phone thought was sent is "on phone only" again, eviction stops, and each shift
 * the server once acknowledged gets a [ResendMark] for [RestoreResend]. A second restore while that
 * runs starts each of them over. The first generation seen is only stored.
 */
class RestoreCheck(private val store: LocalStore) {
    private val lock = Mutex()

    /** The last generation seen, and the server it belongs to (each server counts its own). */
    @Volatile
    private var known: Pair<String, Long>? = null

    /** True from a restore until every shift was sent again (also read from the marks after a restart). */
    @Volatile
    var restored: Boolean = false
        private set

    suspend fun observe(identity: ServerIdentity, @Suppress("UNUSED_PARAMETER") expectedInstance: String?) {
        val gen = identity.restoreGeneration ?: return
        val instance = identity.instanceId ?: return
        known?.let { (i, g) -> if (i == instance && gen <= g) return } // the usual answer: nothing new, no database read
        lock.withLock { check(instance, gen) }
    }

    /** Waits for checks still running (the sender reads the marks after them). */
    suspend fun settled() {
        lock.withLock { }
    }

    fun acknowledge() {
        restored = false
    }

    private suspend fun check(instance: String, gen: Long) {
        // The store is the paired server's view (`ServerBinding.view`): the key is that server's own,
        // and only its shifts are marked.
        val stored = store.get(KEY)?.toLongOrNull()
        if (stored != null && gen <= stored) {
            known = instance to stored
            return
        }
        store.transaction {
            if (stored != null) {
                restored = true
                // Every shift whose create is not still queued (15 section 9.3), the running one too.
                val shifts = store.shifts(Int.MAX_VALUE).filter { !store.hasChange(ChangeType.SHIFT_CREATE, it.clientId) }
                store.markForResend(shifts.map { it.clientId }) { id -> ResendMark(id, gen, ResendMark.Phase.TODO, 0) }
                for (s in shifts) {
                    // The restored server hands out its ids again from where the backup stopped: the answers set them anew.
                    store.upsertShift(
                        s.copy(
                            serverId = null,
                            sendState = if (s.sendState == SendState.SENT) SendState.ON_PHONE_ONLY else s.sendState,
                            serverDeductionKnown = if (s.sendState == SendState.SENT) false else s.serverDeductionKnown,
                        ),
                    )
                    for (t in store.trips(s.clientId)) if (t.serverId != null) store.upsertTrip(t.copy(serverId = null))
                }
            }
            store.put(KEY, gen.toString())
        }
        known = instance to gen
    }

    companion object {
        const val KEY = "sync.restoreGen"
    }
}
