package app.milewage.core.tracking

/*
 * Ports of the tracking layer. The Android tracking module (`:tracking`) and the app implement
 * them; `InMemoryTracking.kt` has in-memory versions for tests and for wiring before the real
 * storage lands. None of them may log or send a coordinate anywhere but the fix store.
 */

/**
 * The points table. The service appends every fix of a running shift here as it arrives; the
 * shift's end, the sender and the live distance after a restart read it back.
 *
 * Implemented on Room over the points table by `:data` (a later task); [InMemoryFixStore] until then.
 */
interface FixStore {
    /**
     * Stores [fixes] (in the order given) for [shiftClientId] and returns them with their `seq`
     * assigned: strictly increasing, never reused, also across shifts (as the Expo tracker's
     * AUTOINCREMENT). The `seq` and `shiftClientId` of the input are ignored. Nothing is filtered.
     */
    suspend fun append(shiftClientId: String, fixes: List<RecordedFix>): List<RecordedFix>

    /** Every stored fix of the shift (sent to the server or not), in `seq` order. */
    suspend fun fixesFor(shiftClientId: String): List<RecordedFix>

    /** The highest `seq` stored for the shift, or null when it has none. */
    suspend fun lastSeq(shiftClientId: String): Long?
}

/** The shift being recorded: which one and when it started (the phone's clock, epoch ms). */
data class ActiveShift(val shiftClientId: String, val startedAt: Long) {
    init {
        require(shiftClientId.isNotBlank()) { "blank shift id" }
    }
}

/**
 * Which shift is recording, persisted, so a service restarted after a kill or a reboot knows. Set
 * before the service starts and cleared before it stops (so a stop never schedules a restart).
 */
interface ActiveShiftStore {
    suspend fun get(): ActiveShift?

    suspend fun set(shift: ActiveShift?)
}

/** [TrackingSettings], persisted. */
interface TrackingSettingsStore {
    suspend fun get(): TrackingSettings

    suspend fun set(settings: TrackingSettings)
}

/** Why recording stopped for a while during a shift. */
enum class InterruptionReason {
    /** The service was not running (killed, crashed) while the shift was recording at full rate. */
    SERVICE_RESTARTED,

    /** The phone's Location switch was off. */
    LOCATION_OFF,

    /** Location permission was taken away. */
    PERMISSION_LOST,
}

/** A span with no recording that the tracker knows about (the engine's `interruptions`, flag `tracking_interrupted`). */
data class Interruption(val fromMs: Long, val toMs: Long, val reason: InterruptionReason) {
    init {
        require(toMs >= fromMs) { "interruption ends before it starts" }
    }
}

/**
 * The interruptions of each shift. The engine copies them into `tracking_interrupted` flags; they
 * never change a distance (the engine's gap rules decide that from the fixes alone).
 */
interface InterruptionLog {
    suspend fun record(shiftClientId: String, interruption: Interruption)

    suspend fun list(shiftClientId: String): List<Interruption>

    suspend fun clear(shiftClientId: String)
}

/**
 * Small text values the service keeps across process death: the stillness snapshot,
 * the notification details, the last GNSS offset. Keys are the service's own.
 */
interface TrackingStateStore {
    suspend fun load(key: String): String?

    /** Null removes the key. */
    suspend fun save(key: String, value: String?)
}

/** What the app said to a command from a notification. */
enum class CommandOutcome {
    /** Done; the app has called the tracking controller as needed. */
    DONE,

    /** It needs the driver in the app (for example no vehicle yet): the tracker posts "Open MileWage". */
    OPEN_APP,
}

/**
 * The seam to the app's shift logic for the notification buttons. Ending a shift is more than
 * recording (the shift row, the server call, the engine run and the hand-off at the end), so the
 * tracking layer never does it on its own: it asks the app, and the app calls
 * `TrackingController.stopShift` back.
 */
interface ShiftCommands {
    /** "End shift" on the shift or the "Still on shift?" notification. */
    suspend fun endShift(): CommandOutcome
}

/**
 * Diagnostics: counts and states only, never a coordinate (the Expo tracker's privacy rule: logcat
 * survives into release builds). The app forwards them to its diagnostics ring, or drops them.
 */
fun interface TrackingDiagnostics {
    fun record(event: String, detail: Map<String, String>)

    companion object {
        val NONE = TrackingDiagnostics { _, _ -> }
    }
}
