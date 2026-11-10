package app.milewage.core.sync

import app.milewage.core.api.Segmenter
import app.milewage.core.pairing.HaltReason
import app.milewage.core.ports.Clock
import app.milewage.core.shift.Bookkeeping
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Markers, the banner, storage thresholds, backoff and the unsynced reminders (ports of status.test and notifications.test). */
class StatusTest {
    private val day = 86_400_000L

    private fun shift(send: SendState, recon: ReconStatus = ReconStatus.PENDING, ended: Long? = 100_000) = ShiftRecord(
        clientId = "s", vehicleId = 3, status = ShiftStatus.ENDED, segmenter = Segmenter.STOPS, startedAt = 1_000, endedAt = ended,
        localDate = "2026-11-01", updatedAt = 1, sendState = send, recon = recon,
    )

    private fun input(
        shifts: List<ShiftRecord> = emptyList(),
        parked: Int = 0,
        halt: HaltReason? = null,
        restored: Boolean = false,
        offline: Boolean = false,
        storage: StorageState = StorageState.NORMAL,
    ) = StatusInput(shifts, 0, parked, null, halt, restored, offline, storage)

    @Test
    fun oneMarkerPerSendStateWithABadgeWhenTheTotalsDiffer() {
        assertEquals(ShiftMarker.ON_PHONE_ONLY, ShiftMarker.of(shift(SendState.ON_PHONE_ONLY)))
        assertEquals(ShiftMarker.SENDING, ShiftMarker.of(shift(SendState.SENDING)))
        assertEquals(ShiftMarker.NEEDS_ATTENTION, ShiftMarker.of(shift(SendState.NEEDS_ATTENTION)))
        assertEquals(ShiftMarker.SENT, ShiftMarker.of(shift(SendState.SENT, ReconStatus.MATCH)))
        assertEquals(ShiftMarker.SENT_DIFFERS, ShiftMarker.of(shift(SendState.SENT, ReconStatus.DIFFERS)))
    }

    @Test
    fun storageThresholdsAre200And50MbAndAnUnreadableValueIsUnknown() {
        assertEquals(StorageState.UNKNOWN, storageState(null))
        assertEquals(StorageState.NORMAL, storageState(LOW_STORAGE_BYTES))
        assertEquals(StorageState.LOW, storageState(LOW_STORAGE_BYTES - 1))
        assertEquals(StorageState.CRITICAL, storageState(CRITICAL_STORAGE_BYTES - 1))
    }

    @Test
    fun coloursAndSentencesForEveryState() {
        assertEquals(StatusColor.GREEN, buildStatus(input()).color)
        assertNull(buildStatus(input()).message)
        val waiting = buildStatus(input(listOf(shift(SendState.ON_PHONE_ONLY)), offline = true))
        assertEquals(StatusColor.YELLOW, waiting.color)
        assertEquals(StatusMessage.OFFLINE, waiting.message)
        assertEquals(1, waiting.unsentShifts)
        assertEquals(100_000, waiting.oldestAt)
        assertEquals(StatusColor.YELLOW, buildStatus(input(listOf(shift(SendState.ON_PHONE_ONLY)))).color)
        assertNull(buildStatus(input(listOf(shift(SendState.ON_PHONE_ONLY)))).message)
        // Most serious first (15 section 9.4).
        val all = input(listOf(shift(SendState.NEEDS_ATTENTION)), parked = 1, halt = HaltReason.WRONG_SERVER, restored = true, storage = StorageState.CRITICAL)
        assertEquals(StatusMessage.WRONG_SERVER, buildStatus(all).message)
        assertEquals(StatusMessage.REVOKED, buildStatus(all.copy(halt = HaltReason.REPAIR)).message)
        assertEquals(StatusMessage.AUTH_PROBLEM, buildStatus(all.copy(halt = HaltReason.AUTH_PROBLEM)).message)
        assertEquals(StatusMessage.RESTORED, buildStatus(all.copy(halt = null)).message)
        assertEquals(StatusMessage.STORAGE_CRITICAL, buildStatus(all.copy(halt = null, restored = false)).message)
        assertEquals(StatusMessage.NEEDS_ATTENTION, buildStatus(all.copy(halt = null, restored = false, storage = StorageState.NORMAL)).message)
        assertEquals(StatusColor.RED, buildStatus(input(parked = 1)).color)
        assertEquals(StatusColor.YELLOW, buildStatus(input(storage = StorageState.LOW)).color)
        assertEquals(StatusMessage.STORAGE_LOW, buildStatus(input(storage = StorageState.LOW)).message)
    }

    @Test
    fun backoffIs2_4_8_16_32_60WithJitterAndRetryAfterWins() {
        val b = Backoff { 0.5 }
        assertEquals(listOf(2_000L, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000), (1..7).map { b.next() })
        b.reset()
        assertEquals(30_000, b.next(30))
        assertEquals(4_000, b.next())
        val low = Backoff { 0.0 }
        assertEquals(1_600, low.next())
        val high = Backoff { 1.0 }
        assertEquals(2_400, high.next())
    }

    @Test
    fun remindersNoneBefore3DaysThenOnceADayStrongerFrom7Days() {
        val oldest = 0L
        val early = Reminder.dueAt(oldest, 2, 2 * day, null)
        assertEquals(Reminder.Level.NONE, early.level)
        assertEquals(3 * day, early.nextAt)
        val due = Reminder.dueAt(oldest, 2, 3 * day, null)
        assertEquals(Reminder.Level.NORMAL, due.level)
        assertEquals(4 * day, due.nextAt)
        assertEquals(Reminder.Level.NONE, Reminder.dueAt(oldest, 2, 3 * day + 1_000, 3 * day).level)
        val strong = Reminder.dueAt(oldest, 1, 8 * day, 6 * day)
        assertEquals(Reminder.Level.STRONG, strong.level)
        assertEquals(8, strong.days)
        assertEquals(Reminder.Level.NONE, Reminder.dueAt(null, 0, 8 * day, null).level)
    }

    private class Book : Bookkeeping {
        val map = HashMap<String, String>()

        override suspend fun get(key: String) = map[key]

        override suspend fun put(key: String, value: String) {
            map[key] = value
        }

        override suspend fun remove(key: String) {
            map.remove(key)
        }
    }

    private class Port(var allowed: Boolean = true) : ReminderPort {
        val log = ArrayList<String>()

        override suspend fun show(reminder: Reminder) {
            log += "show ${reminder.level}"
        }

        override suspend fun schedule(atMs: Long, reminder: Reminder) {
            log += "schedule $atMs ${reminder.level}"
        }

        override suspend fun cancel() {
            log += "cancel"
        }

        override suspend fun granted() = allowed
    }

    @Test
    fun theOsReminderIsScheduledShownAtMostDailyAndCancelledWhenNothingWaits() = runBlocking {
        var now = 1 * day
        val port = Port()
        val r = UnsyncedReminders(port, Book(), Clock { now })
        // Before 3 days: one scheduled for the 3-day mark, nothing shown.
        r.update(0, 1)
        assertEquals(listOf("schedule ${3 * day} NORMAL"), port.log)
        // The same state again schedules nothing new (dedupe).
        r.update(0, 1)
        assertEquals(1, port.log.size)
        // A pending reminder whose time has passed counts as shown: nothing now, the next a day after it.
        now = 3 * day + 10
        r.update(0, 1)
        assertEquals(listOf("schedule ${4 * day} NORMAL"), port.log.drop(1))
        // From 7 days the scheduled words are the stronger ones.
        now = 6 * day + 10
        port.log.clear()
        r.update(0, 1)
        assertTrue(port.log.contains("show NORMAL"), port.log.toString())
        assertTrue(port.log.last().endsWith("STRONG"), port.log.toString())
        // Nothing waits: the pending and the shown one are cancelled, once.
        port.log.clear()
        r.update(null, 0)
        r.update(null, 0)
        assertEquals(listOf("cancel"), port.log)
    }

    @Test
    fun dueWithNoReminderTodayShowsOneUnlessTheBannerAlreadyDid() = runBlocking {
        val now = 3 * day + 10
        val port = Port()
        UnsyncedReminders(port, Book(), Clock { now }).update(0, 2)
        assertEquals(listOf("show NORMAL", "schedule ${4 * day + 10} NORMAL"), port.log)

        val quiet = Port()
        val r = UnsyncedReminders(quiet, Book(), Clock { now })
        r.bannerShown()
        r.update(0, 2)
        assertEquals(listOf("schedule ${4 * day + 10} NORMAL"), quiet.log)
    }

    @Test
    fun withoutThePermissionNothingIsShownScheduledOrStored() = runBlocking {
        val port = Port(allowed = false)
        val book = Book()
        UnsyncedReminders(port, book, Clock { 5 * day }).update(0, 1)
        assertEquals(emptyList(), port.log)
        assertTrue(book.map.isEmpty())
    }
}
