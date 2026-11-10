package app.milewage.core.sync

import app.milewage.core.ports.Clock
import app.milewage.core.shift.FixQueue

/**
 * How long the phone keeps the fixes, the record of every shift (15 section 3.2).
 *
 * The Expo app's rule, ported exactly: a fix the server acknowledged is deleted 14 days after the
 * acknowledgement (`uploaded_at < now - 14 days`), never a fix still pending, and nothing at all
 * while a server restore may still ask for them (the restore flag is up, or any shift waits to be
 * sent again). The Expo app ran it at the end of each upload drain; here at the end of each round.
 *
 * One condition is added on purpose (the founding rule: nothing is lost while the server does not
 * have it): the fix's shift must be confirmed by the server, that is "sent" with its `end` accepted
 * and nothing of it queued, and never the running shift. A shift whose end was refused or still
 * waits keeps every fix, however old. `FixQueue.evictSent` applies these conditions in one query.
 */
object Retention {
    const val KEEP_SENT_MS = 14 * 86_400_000L

    /** Whether eviction may run now. */
    fun allowed(restored: Boolean, resendWaiting: Boolean): Boolean = !restored && !resendWaiting

    /** Fixes acknowledged before this time may go (their shift confirmed). */
    fun cutoff(now: Long): Long = now - KEEP_SENT_MS

    internal suspend fun apply(fixes: FixQueue, restore: RestoreCheck, resend: RestoreResend, clock: Clock): Int {
        if (!allowed(restore.restored, resend.waiting())) return 0
        return fixes.evictSent(cutoff(clock.nowMs()))
    }
}
