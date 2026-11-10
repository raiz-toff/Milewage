package app.milewage.core.sync

import app.milewage.core.api.ChangeType
import app.milewage.core.api.ShiftRequests
import kotlinx.serialization.json.JsonObject

/** One queued change: the exact request body (the contract's model as JSON), as `ShiftRequests` built it. */
data class OutboxItem(
    val id: Long,
    val kind: ChangeType,
    /** Starts with the shift's client id; see [ShiftRequests.route]. */
    val entityKey: String,
    val body: JsonObject,
    val createdAt: Long,
    val attempts: Int,
    val lastError: String?,
    /** The server refused it for good; kept for the driver, not sent again unless retried. */
    val parked: Boolean,
) {
    val shiftClientId: String get() = ShiftRequests.shiftOf(entityKey)
}

data class OutboxCounts(val pending: Int, val parked: Int, val oldestAt: Long?)

/**
 * A shift to send again after the server was restored (15 section 9.3). [Phase.TODO]: nothing of
 * it was accepted again since the restore [gen] (or up to [afterSeq], the last fix accepted again);
 * [Phase.QUEUED]: created again, fixes sent again, its readings, edits and end are in the outbox;
 * the row goes when the end is accepted.
 */
data class ResendMark(val shiftClientId: String, val gen: Long, val phase: Phase, val afterSeq: Long) {
    enum class Phase(val wire: String) {
        TODO("todo"),
        QUEUED("queued"),
        ;

        companion object {
            fun of(wire: String): Phase = if (wire == "queued") QUEUED else TODO
        }
    }
}
