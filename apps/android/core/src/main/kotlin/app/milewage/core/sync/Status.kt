package app.milewage.core.sync

import app.milewage.core.pairing.HaltReason
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import kotlin.math.roundToLong

/** 2, 4, 8, 16, 32, then 60 s, each with +-20% jitter; a success resets it (08 section 4.3). */
class Backoff(private val rand: () -> Double) {
    private var step = 0

    /** The next wait in ms; [retryAfterS] (the server's `Retry-After`) wins when given. */
    fun next(retryAfterS: Long? = null): Long {
        if (retryAfterS != null) {
            step = minOf(step + 1, STEPS_S.size)
            return retryAfterS * 1000
        }
        val base = STEPS_S[minOf(step, STEPS_S.size - 1)] * 1000
        step = minOf(step + 1, STEPS_S.size)
        return (base * (0.8 + 0.4 * rand())).roundToLong()
    }

    fun reset() {
        step = 0
    }

    companion object {
        val STEPS_S = longArrayOf(2, 4, 8, 16, 32, 60)
    }
}

/** The marker on a shift row (15 section 4.1). */
enum class ShiftMarker {
    /** "On phone only". */
    ON_PHONE_ONLY,

    /** "Sending". */
    SENDING,

    /** "Sent to the server". */
    SENT,

    /** "Sent to the server (total differs)": a Difference. */
    SENT_DIFFERS,

    /** "Needs attention". */
    NEEDS_ATTENTION,

    /**
     * "Recorded for another server": not yet sent, and bound to another server than the one the
     * phone is paired with now. It goes only to that server (`ServerBinding`).
     */
    OTHER_SERVER,
    ;

    companion object {
        fun of(s: ShiftRecord): ShiftMarker = when (s.sendState) {
            SendState.ON_PHONE_ONLY -> ON_PHONE_ONLY
            SendState.SENDING -> SENDING
            SendState.NEEDS_ATTENTION -> NEEDS_ATTENTION
            SendState.SENT -> if (s.recon == ReconStatus.DIFFERS) SENT_DIFFERS else SENT
        }

        /** As [of], with the phone paired with [pairedInstance]: a shift still waiting for another server says so. */
        fun of(s: ShiftRecord, pairedInstance: String?): ShiftMarker =
            if (s.sendState != SendState.SENT && !ServerBinding.boundTo(s.instanceId, pairedInstance)) OTHER_SERVER else of(s)
    }
}

enum class StorageState { UNKNOWN, NORMAL, LOW, CRITICAL }

/** 15 section 3.4. An unreadable free space (null) is unknown, never "normal". */
fun storageState(freeBytes: Long?): StorageState = when {
    freeBytes == null -> StorageState.UNKNOWN
    freeBytes < CRITICAL_STORAGE_BYTES -> StorageState.CRITICAL
    freeBytes < LOW_STORAGE_BYTES -> StorageState.LOW
    else -> StorageState.NORMAL
}

const val LOW_STORAGE_BYTES = 200L * 1024 * 1024
const val CRITICAL_STORAGE_BYTES = 50L * 1024 * 1024

enum class StatusColor { GREEN, YELLOW, RED }

/**
 * The one sentence the home banner shows, most serious first (15 section 9.4). The Expo app's
 * English is in each KDoc for strings.xml.
 */
enum class StatusMessage {
    /** "This address now points to a different MileWage server than the one this phone was paired with. Nothing was sent." */
    WRONG_SERVER,

    /** "This phone was removed from your server. Re-pair to send your saved data." */
    REVOKED,

    /** "Sign-in problem. Re-pair this phone." */
    AUTH_PROBLEM,

    /** "The server was restored from a backup. MileWage is re-sending the last 14 days from your phone." */
    RESTORED,

    /** "Phone storage is almost full. MileWage may stop recording. Free some space now." */
    STORAGE_CRITICAL,

    /** "Phone storage is low. Free some space so MileWage can keep recording." */
    STORAGE_LOW,

    /** "Some items could not be sent. Open the shift to see why." */
    NEEDS_ATTENTION,

    /** "Offline. Saved on your phone." */
    OFFLINE,
}

data class StatusInput(
    val shifts: List<ShiftRecord>,
    val pendingFixes: Long,
    val parkedItems: Int,
    val oldestQueuedAt: Long?,
    val halt: HaltReason?,
    /** The server was restored from a backup and shifts are still being sent again. */
    val restored: Boolean,
    val offline: Boolean,
    val storage: StorageState,
)

/** What the screens read about sending: the banner's colour, numbers and sentence. */
data class SyncStatus(
    val color: StatusColor,
    /** Shifts not yet sent to the server (the running one included). */
    val unsentShifts: Int,
    /** Fixes not yet accepted by the server. */
    val unsentFixes: Long,
    /** When the oldest of them ended (or started, while running), or the oldest queued change. */
    val oldestAt: Long?,
    val message: StatusMessage?,
    val halt: HaltReason?,
)

/** The home banner (15 section 4.3): green nothing waits, yellow something waits or offline, red needs the driver. */
fun buildStatus(i: StatusInput): SyncStatus {
    val open = i.shifts.filter { it.sendState != SendState.SENT }
    val times = open.map { it.endedAt ?: it.startedAt }.toMutableList()
    i.oldestQueuedAt?.let(times::add)
    val attention = open.any { it.sendState == SendState.NEEDS_ATTENTION } || i.parkedItems > 0
    val message = when {
        i.halt == HaltReason.WRONG_SERVER -> StatusMessage.WRONG_SERVER
        i.halt == HaltReason.REPAIR -> StatusMessage.REVOKED
        i.halt == HaltReason.AUTH_PROBLEM -> StatusMessage.AUTH_PROBLEM
        i.restored -> StatusMessage.RESTORED
        i.storage == StorageState.CRITICAL -> StatusMessage.STORAGE_CRITICAL
        i.storage == StorageState.LOW -> StatusMessage.STORAGE_LOW
        attention -> StatusMessage.NEEDS_ATTENTION
        i.offline && open.isNotEmpty() -> StatusMessage.OFFLINE
        else -> null
    }
    val red = i.halt != null || attention || i.restored || i.storage == StorageState.CRITICAL
    val color = when {
        red -> StatusColor.RED
        open.isNotEmpty() || i.offline || i.storage == StorageState.LOW -> StatusColor.YELLOW
        else -> StatusColor.GREEN
    }
    return SyncStatus(color, open.size, i.pendingFixes, times.minOrNull(), message, i.halt)
}
