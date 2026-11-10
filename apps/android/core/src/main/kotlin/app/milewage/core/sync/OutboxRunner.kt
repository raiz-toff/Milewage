package app.milewage.core.sync

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiResponse
import app.milewage.core.api.ChangeType
import app.milewage.core.api.MileWageHeaders
import app.milewage.core.api.ShiftRequests
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.pairing.DeviceSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.JsonElement

enum class RunState {
    IDLE,
    BUSY,
    NOT_PAIRED,
    OFFLINE,

    /** The device session stops sending (revoked, wrong server, sign-in problem). */
    HALTED,
}

data class RunResult(val state: RunState, val sent: Int, val parked: Int, val retryInMs: Long?)

/** An answered change. [finalized]: 409 `shift_finalized`, nothing more can be sent for it. */
data class Sent(val item: OutboxItem, val finalized: Boolean, val response: ApiResponse<JsonElement>?, val applied: Boolean)

/** What to do with a change the server refused without a retryable error. */
enum class Refusal {
    /** Kept for the driver to see; holds back the rest of its shift. */
    PARK,

    /** Kept pending and tried again next round; holds back the rest of its shift for now. */
    KEEP,
}

/**
 * Sends outbox items one at a time, oldest first (15 section 6.2 step 4, 08 section 4.1), a port of
 * the Expo app's `sync/runner.ts`. A network failure or a 5xx stops the run and keeps the item
 * (backoff 2/4/8/16/32/60 s); a 4xx parks that item and holds back only the later items of the same
 * shift; while the device session is halted nothing is sent. Nothing is ever dropped. Internal to the
 * [Sender].
 */
class OutboxRunner(
    private val outbox: Outbox,
    private val session: suspend () -> DeviceClient?,
    private val device: DeviceSession,
    /** False keeps the item (and the rest of its shift) pending: the `shift.end` barrier and the restore hold. */
    private val canSend: suspend (OutboxItem) -> Boolean,
    private val onSent: suspend (Sent) -> Unit,
    private val onRefused: suspend (OutboxItem, ApiException) -> Refusal,
    rand: () -> Double,
) {
    private val busy = Mutex()
    private val backoff = Backoff(rand)

    init {
        device.subscribe { backoff.reset() }
    }

    /** Runs until the queue is empty, blocked, halted or a retryable failure. [shift] limits it to one shift. */
    suspend fun run(shift: String? = null): RunResult {
        if (!busy.tryLock()) return RunResult(RunState.BUSY, 0, 0, null)
        try {
            return loop(shift)
        } finally {
            busy.unlock()
        }
    }

    private suspend fun loop(only: String?): RunResult {
        var sent = 0
        var parked = 0
        fun result(state: RunState, retry: Long? = null) = RunResult(state, sent, parked, retry)
        if (device.halted() != null) return result(RunState.HALTED)
        val s = session() ?: return result(RunState.NOT_PAIRED)

        val blocked = outbox.parked().map { it.shiftClientId }.toHashSet()
        for (item in outbox.pending()) {
            val shift = item.shiftClientId
            if ((only != null && shift != only) || shift in blocked) continue
            if (!canSend(item)) {
                blocked.add(shift)
                continue
            }
            val req = ShiftRequests.requestFor(item.kind, item.entityKey, item.body)
            outbox.begin(item)
            try {
                val response = s.client.send(req)
                outbox.done(item)
                backoff.reset()
                sent++
                onSent(Sent(item, false, response, response.headers[MileWageHeaders.APPLIED] != "false"))
            } catch (e: ApiException) {
                if (device.halted() != null) {
                    outbox.failed(item.id, e.code)
                    return result(RunState.HALTED)
                }
                if (e.retryable) {
                    outbox.failed(item.id, e.code)
                    return result(RunState.OFFLINE, backoff.next(e.retryAfterS))
                }
                if (e.status == 409 && e.code == ApiCodes.SHIFT_FINALIZED && item.kind != ChangeType.SHIFT_CREATE) {
                    outbox.done(item)
                    onSent(Sent(item, true, null, false))
                    continue
                }
                when (onRefused(item, e)) {
                    Refusal.KEEP -> outbox.failed(item.id, e.code)
                    Refusal.PARK -> {
                        outbox.park(item.id, e.code)
                        parked++
                    }
                }
                blocked.add(shift)
            } catch (e: CancellationException) {
                outbox.release(item.id)
                throw e
            } catch (e: RuntimeException) {
                // A bug, not an answer: the row stays as it is and the caller sees the throw.
                outbox.release(item.id)
                throw e
            }
        }
        return result(RunState.IDLE)
    }
}
