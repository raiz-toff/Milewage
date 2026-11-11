package app.milewage.core.tracking

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/*
 * In-memory implementations of the tracking ports, for tests in any module and for wiring the app
 * before the Room fix store lands. Nothing here survives the process.
 */

/** [FixStore] in memory: one global `seq` counter, as the points table's AUTOINCREMENT. */
class InMemoryFixStore : FixStore {
    private val lock = Mutex()
    private val rows = ArrayList<RecordedFix>()
    private var nextSeq = 1L

    override suspend fun append(shiftClientId: String, fixes: List<RecordedFix>): List<RecordedFix> = lock.withLock {
        fixes.map { f -> f.copy(seq = nextSeq++, shiftClientId = shiftClientId).also(rows::add) }
    }

    override suspend fun fixesFor(shiftClientId: String): List<RecordedFix> = lock.withLock {
        rows.filter { it.shiftClientId == shiftClientId }
    }

    override suspend fun lastSeq(shiftClientId: String): Long? = lock.withLock {
        rows.lastOrNull { it.shiftClientId == shiftClientId }?.seq
    }

    /** Every row of every shift, in `seq` order (tests). */
    suspend fun all(): List<RecordedFix> = lock.withLock { rows.toList() }
}

class InMemoryActiveShiftStore(initial: ActiveShift? = null) : ActiveShiftStore {
    private var value: ActiveShift? = initial

    override suspend fun get(): ActiveShift? = value

    override suspend fun set(shift: ActiveShift?) {
        value = shift
    }
}

class InMemoryTrackingSettingsStore(initial: TrackingSettings = TrackingSettings()) : TrackingSettingsStore {
    private var value: TrackingSettings = initial

    override suspend fun get(): TrackingSettings = value

    override suspend fun set(settings: TrackingSettings) {
        value = settings
    }
}

class InMemoryInterruptionLog : InterruptionLog {
    private val lock = Mutex()
    private val byShift = HashMap<String, MutableList<Interruption>>()

    override suspend fun record(shiftClientId: String, interruption: Interruption) = lock.withLock {
        byShift.getOrPut(shiftClientId) { ArrayList() }.add(interruption)
        Unit
    }

    override suspend fun list(shiftClientId: String): List<Interruption> = lock.withLock {
        byShift[shiftClientId]?.toList() ?: emptyList()
    }

    override suspend fun clear(shiftClientId: String) = lock.withLock {
        byShift.remove(shiftClientId)
        Unit
    }
}

class InMemoryTrackingStateStore : TrackingStateStore {
    private val lock = Mutex()
    private val values = HashMap<String, String>()

    override suspend fun load(key: String): String? = lock.withLock { values[key] }

    override suspend fun save(key: String, value: String?) = lock.withLock {
        if (value == null) values.remove(key) else values[key] = value
        Unit
    }
}

/** [ShiftCommands] that records the calls and answers [outcome]. */
class RecordingShiftCommands(var outcome: CommandOutcome = CommandOutcome.DONE) : ShiftCommands {
    var ended = 0

    override suspend fun endShift(): CommandOutcome {
        ended++
        return outcome
    }
}
