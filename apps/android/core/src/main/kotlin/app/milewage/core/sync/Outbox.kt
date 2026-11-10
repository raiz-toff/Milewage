package app.milewage.core.sync

import app.milewage.core.api.ChangeType
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.ShiftRequests
import app.milewage.core.ports.Clock
import app.milewage.core.shift.OutboxStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/**
 * The durable queue of changes the server has not acknowledged (08 section 4.1, 15 section 6.2), a
 * port of the Expo app's `sync/outbox.ts`. Rows stay until the server answers; an answered row is
 * deleted. Everything in it is idempotent on the server (client ids, upserts), so sending again after
 * a kill is always safe. The shift model and the edits add to it; only the sender takes from it.
 *
 * No lock is held around the database (callers may be inside a transaction). An edit that lands on a
 * row while that row is being sent is not lost: the row is deleted after the answer only if its body
 * is still the one that was sent, so the newer body goes in the next round.
 */
class Outbox(private val store: OutboxStore, private val clock: Clock) {
    private val inFlight = MutableStateFlow<Map<Long, kotlinx.serialization.json.JsonObject>>(emptyMap())

    /**
     * Adds a change, encoded once by [ShiftRequests]. A pending `odometer.put`, `trip.override` or
     * `trip.manual` for the same entity that is not being sent right now is replaced in place (it
     * keeps its place in the queue). `shift.create` and `shift.end` are never merged.
     */
    suspend fun enqueue(change: ShiftChange): Long {
        val req = ShiftRequests.encode(change)
        require(req.kind.queued) { "${req.kind} does not go through the outbox" }
        if (req.kind in COALESCED) {
            val target = store.pendingIds(req.kind, req.entityKey).firstOrNull { it !in inFlight.value }
            if (target != null) {
                store.replaceChange(target, req.body)
                return target
            }
        }
        return store.insertChange(req.kind, req.entityKey, req.body, clock.nowMs())
    }

    /** Pending items in send order, oldest first. */
    suspend fun pending(): List<OutboxItem> = store.pendingChanges()

    suspend fun parked(): List<OutboxItem> = store.parkedChanges()

    suspend fun counts(): OutboxCounts = store.changeCounts()

    /** True when this shift still has an unsent item of [kind] (pending or parked). */
    suspend fun has(kind: ChangeType, shiftClientId: String): Boolean = store.hasChange(kind, shiftClientId)

    fun begin(item: OutboxItem) = inFlight.update { it + (item.id to item.body) }

    /** The attempt was interrupted (not an answer): the row stays as it was. */
    fun release(id: Long) = inFlight.update { it - id }

    /** The server answered: the row goes, unless an edit replaced its body meanwhile. */
    suspend fun done(item: OutboxItem) {
        store.deleteSentChange(item.id, item.body)
        release(item.id)
    }

    /** A failure that may pass (network, 5xx): the row stays pending. */
    suspend fun failed(id: Long, error: String) {
        store.changeFailed(id, error)
        release(id)
    }

    /** Refused for good (4xx): kept for the driver to see, not sent again unless retried. */
    suspend fun park(id: Long, error: String) {
        store.parkChange(id, error)
        release(id)
    }

    /** The driver's retry of what the server refused (after fixing its cause on the web). */
    suspend fun unpark(shiftClientId: String? = null): Int = store.unparkChanges(shiftClientId)

    suspend fun dropShift(shiftClientId: String) = store.dropChanges(shiftClientId)

    companion object {
        /** Latest write wins in place: the request is a full-state upsert (15 section 6.2 step 4). */
        val COALESCED = setOf(ChangeType.ODOMETER_PUT, ChangeType.TRIP_OVERRIDE, ChangeType.TRIP_MANUAL)
    }
}
