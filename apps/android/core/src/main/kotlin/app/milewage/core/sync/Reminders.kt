package app.milewage.core.sync

import app.milewage.core.ports.Clock
import app.milewage.core.shift.Bookkeeping
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private const val DAY = 86_400_000L

/**
 * The unsynced reminder due now (15 section 4.4; decision 1.5d): none before 3 days, then at most
 * once a day, with stronger words from 7 days. The words are the screen's (strings.xml); the Expo
 * app's English:
 * - [Level.NORMAL]: "{n} shift(s) is/are only on this phone. Open MileWage when you reach your server."
 * - [Level.STRONG]: "{n} shift(s) is/are only on this phone, for {days} days. If the phone is lost they
 *   are gone. Open MileWage when you reach your server."
 */
data class Reminder(
    val level: Level,
    val unsentShifts: Int,
    /** Whole days since the oldest unsent shift ended. */
    val days: Long,
    /** When the next reminder is due after this one is given (epoch ms; Long.MAX_VALUE: never). */
    val nextAt: Long,
) {
    enum class Level { NONE, NORMAL, STRONG }

    companion object {
        const val FIRST_DAYS = 3L
        const val STRONG_DAYS = 7L

        /** [lastShownAt]: when the previous one was given (banner or notification); null: none yet. */
        fun dueAt(oldestUnsentAt: Long?, unsentShifts: Int, now: Long, lastShownAt: Long?): Reminder {
            val none = Reminder(Level.NONE, unsentShifts, 0, Long.MAX_VALUE)
            if (oldestUnsentAt == null || unsentShifts == 0) return none
            val age = now - oldestUnsentAt
            val days = maxOf(0, age / DAY)
            if (age < FIRST_DAYS * DAY) return none.copy(days = days, nextAt = oldestUnsentAt + FIRST_DAYS * DAY)
            if (lastShownAt != null && now - lastShownAt < DAY) return none.copy(days = days, nextAt = lastShownAt + DAY)
            val level = if (age >= STRONG_DAYS * DAY) Level.STRONG else Level.NORMAL
            return Reminder(level, unsentShifts, days, now + DAY)
        }
    }
}

/**
 * The phone's own notifications (no push service: the phone schedules its reminders itself, 18
 * section 11). `:app` implements it on NotificationManager and an inexact alarm or WorkManager;
 * without the notifications permission every call does nothing and [granted] is false. One id: a
 * new reminder replaces the old one, never a second copy.
 */
interface ReminderPort {
    /** Shows [reminder] now. */
    suspend fun show(reminder: Reminder)

    /** Shows [reminder] at about [atMs] (inexact). Replaces the one pending. */
    suspend fun schedule(atMs: Long, reminder: Reminder)

    /** Removes the pending and the shown reminder. Works without the permission. */
    suspend fun cancel()

    /** Whether a notification would reach the driver now. Reads, never asks. */
    suspend fun granted(): Boolean
}

/**
 * The unsynced reminder as an OS notification, kept in step with the banner (a port of the Expo
 * app's `notifications/unsynced.ts`). Each call keeps exactly one reminder pending in the OS, for
 * the next time one is due, so the driver is reminded even with the app closed. A reminder counts as
 * given when the banner showed it ([bannerShown]), when the pending one's time has passed, or when
 * this shows one now. Nothing unsent: the pending and the shown one are cancelled.
 */
class UnsyncedReminders(
    private val port: ReminderPort,
    private val book: Bookkeeping,
    private val clock: Clock,
) {
    @Serializable
    private data class Saved(val at: Long, val level: String, val days: Long, val shownAt: Long? = null)

    /** The banner showed the reminder now. */
    suspend fun bannerShown() {
        book.put(BANNER_KEY, clock.nowMs().toString())
    }

    suspend fun update(oldestUnsentAt: Long?, unsentShifts: Int) {
        val saved = book.get(SAVED_KEY)?.let { runCatching { JSON.decodeFromString(Saved.serializer(), it) }.getOrNull() }
        if (oldestUnsentAt == null || unsentShifts == 0) {
            if (book.get(SAVED_KEY) != null) {
                port.cancel()
                book.remove(SAVED_KEY)
            }
            return
        }
        if (!port.granted()) return
        val now = clock.nowMs()
        val fired = saved?.at?.takeIf { it <= now }
        val banner = book.get(BANNER_KEY)?.toLongOrNull()
        var last = listOfNotNull(banner, fired, saved?.shownAt).filter { it > 0 }.maxOrNull()
        var shownAt = saved?.shownAt
        val due = Reminder.dueAt(oldestUnsentAt, unsentShifts, now, last)
        if (due.level != Reminder.Level.NONE) {
            port.show(due)
            last = now
            shownAt = now
        }
        val at = due.nextAt
        if (at == Long.MAX_VALUE) return
        // As it will read then: the day count, and the stronger words once 7 days have passed.
        val then = Reminder.dueAt(oldestUnsentAt, unsentShifts, at, last)
        val next = Saved(at, then.level.name, then.days, shownAt)
        if (saved == next) return
        if (saved == null || saved.at != at || saved.level != next.level || saved.days != next.days) port.schedule(at, then)
        book.put(SAVED_KEY, JSON.encodeToString(Saved.serializer(), next))
    }

    companion object {
        const val BANNER_KEY = "reminder.bannerShownAt"
        const val SAVED_KEY = "reminder.pending"
        private val JSON = Json { ignoreUnknownKeys = true }
    }
}
