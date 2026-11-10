package app.milewage.phone.logic

import app.milewage.core.pairing.HaltReason
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.sync.Progress
import app.milewage.core.sync.Reminder
import app.milewage.core.sync.SendStatus
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.core.tracking.PowerLevel
import app.milewage.core.tracking.TrackingMode
import app.milewage.core.tracking.TrackingProblem
import app.milewage.core.tracking.TrackingStatus
import app.milewage.tracking.TrackingPermissionState

/*
 * The home screen's decisions (start, the running shift's state in words, the sync banner, the
 * setup checklist), in plain Kotlin so they are tested on the JVM. They return types, never words:
 * the words are in strings.xml (ui/Texts.kt maps them), in the MileWage voice.
 */

/** The one way forward a message offers. The screen turns each into a button. */
enum class Fix {
    /** "Fix permissions": the permissions screen (each step there opens the right system page). */
    APP_SETTINGS,

    /** The phone's Location switch. */
    LOCATION_SETTINGS,

    /** The phone's list of apps exempt from battery optimisation. */
    BATTERY_SETTINGS,

    /** The phone's storage settings. */
    STORAGE_SETTINGS,

    /** Ask for the notifications permission (or its settings page once refused for good). */
    NOTIFICATIONS,

    /** Load the vehicle list again. */
    RETRY_VEHICLES,

    /** A send round now, lifting halts and refusals. */
    SEND_NOW,

    /** Check the server's address again after a wrong-server halt. */
    CHECK_ADDRESS,

    /** Pair this phone (again). */
    PAIR,

    /** The shifts list. */
    OPEN_SHIFTS,

    /** Start the tracker again for the running shift. */
    RESUME_RECORDING,

    /** Stop the send round in progress. */
    STOP_SENDING,

    /** Start the shift again (after a failure that wrote nothing). */
    START_AGAIN,
}

/** Where the vehicle list came from. */
enum class VehicleSource {
    /** Just loaded from the server. */
    SERVER,

    /** The copy from the last connection (offline). */
    KEPT,

    /** Not loaded yet. */
    LOADING,
}

data class VehicleChoice(
    val vehicles: List<VehicleRecord> = emptyList(),
    val selectedId: Long? = null,
    val source: VehicleSource = VehicleSource.LOADING,
) {
    val selected: VehicleRecord? get() = vehicles.firstOrNull { it.id == selectedId }

    companion object {
        /** Keeps the driver's pick, else the last vehicle used, else the server's default, else the first. */
        fun pick(vehicles: List<VehicleRecord>, current: Long?, last: Long?, default: Long?): Long? =
            listOf(current, last, default).firstNotNullOfOrNull { id -> vehicles.firstOrNull { it.id == id }?.id } ?: vehicles.firstOrNull()?.id
    }
}

/** Why a shift cannot start, each with its one way forward. */
enum class StartProblem(val fix: Fix?) {
    /** The Location switch is off: name the switch, not the permission. */
    LOCATION_OFF(Fix.LOCATION_SETTINGS),

    /** No location permission at all. */
    NO_PERMISSION(Fix.APP_SETTINGS),

    /** Only approximate location: GPS needs precise. */
    APPROXIMATE_ONLY(Fix.APP_SETTINGS),

    /** No pairing on this phone (a debug build's unpaired view). */
    NOT_PAIRED(Fix.PAIR),

    /** No vehicle list and the server cannot be reached. */
    VEHICLES_NOT_LOADED(Fix.RETRY_VEHICLES),

    /** The server has no vehicle. */
    NO_VEHICLES(Fix.RETRY_VEHICLES),

    /** Android refused to start the tracker. Nothing was written. */
    TRACKER_REFUSED(Fix.APP_SETTINGS),

    /** Something failed while starting. Nothing was written. */
    FAILED(Fix.START_AGAIN),
}

object StartGate {
    /**
     * Whether "Start shift" may go ahead, checked in the order the driver can fix things: the
     * Location switch, the permission, pairing, a vehicle. With the server's tracking module off
     * nothing is recorded, so location is not needed.
     */
    fun check(perm: TrackingPermissionState, trackingOn: Boolean, pairing: PairingStatus, vehicles: VehicleChoice): StartProblem? = when {
        trackingOn && !perm.locationEnabled -> StartProblem.LOCATION_OFF
        trackingOn && perm.approximateOnly -> StartProblem.APPROXIMATE_ONLY
        trackingOn && !perm.preciseLocation -> StartProblem.NO_PERMISSION
        pairing == PairingStatus.UNPAIRED -> StartProblem.NOT_PAIRED
        vehicles.selected != null -> null
        vehicles.source == VehicleSource.SERVER -> StartProblem.NO_VEHICLES
        else -> StartProblem.VEHICLES_NOT_LOADED
    }
}

/** The running shift's tracking state in words, most urgent first. */
enum class TrackingLine(val fix: Fix?, val problem: Boolean) {
    RECORDING(null, false),

    /** Low-power watch while stopped; picks up on the next move. */
    SAVING_BATTERY(null, false),

    /** The screen has just opened: the tracker is being checked. */
    STARTING(null, false),

    /** The server's tracking module is off: only the shift's time is kept. */
    SERVER_TRACKING_OFF(null, false),

    /** Recording, but without "Allow all the time" it may stop with the screen off. */
    NO_BACKGROUND(Fix.APP_SETTINGS, true),

    /** The Location switch is off: recording is paused. */
    LOCATION_OFF(Fix.LOCATION_SETTINGS, true),

    /** The location permission was taken away. */
    PERMISSION_LOST(Fix.APP_SETTINGS, true),

    /** The phone reports no location source. */
    NO_PROVIDER(Fix.LOCATION_SETTINGS, true),

    /** The shift runs but the tracker does not record it (killed, a restart, refused): resume or end it. */
    NOT_RECORDING(Fix.RESUME_RECORDING, true),
}

object TrackingLines {
    /**
     * [checked]: the screen has already asked the tracker to resume (`ensureRunning`), so "not
     * recording" is real and not a start-up moment.
     */
    fun of(running: ShiftRecord, status: TrackingStatus, perm: TrackingPermissionState, trackingOn: Boolean, checked: Boolean): TrackingLine {
        if (!trackingOn) return TrackingLine.SERVER_TRACKING_OFF
        if (!perm.locationEnabled) return TrackingLine.LOCATION_OFF
        if (!perm.preciseLocation) return TrackingLine.PERMISSION_LOST
        val mine = status.mode == TrackingMode.RECORDING && status.shiftClientId == running.clientId
        if (!mine) return if (checked) TrackingLine.NOT_RECORDING else TrackingLine.STARTING
        return when (status.problem) {
            TrackingProblem.LOCATION_OFF -> TrackingLine.LOCATION_OFF
            TrackingProblem.NO_LOCATION_PERMISSION -> TrackingLine.PERMISSION_LOST
            TrackingProblem.NO_LOCATION_PROVIDER -> TrackingLine.NO_PROVIDER
            else -> when {
                status.power == PowerLevel.LOW -> TrackingLine.SAVING_BATTERY
                !perm.backgroundLocation -> TrackingLine.NO_BACKGROUND
                else -> TrackingLine.RECORDING
            }
        }
    }
}

/** What the sync banner says, most serious first (15 section 4.3), each with its one action. */
enum class BannerKind(val fix: Fix?) {
    ALL_SENT(null),
    WAITING(Fix.SEND_NOW),
    OFFLINE(Fix.SEND_NOW),
    SENDING(Fix.STOP_SENDING),
    WRONG_SERVER(Fix.CHECK_ADDRESS),
    REVOKED(Fix.PAIR),
    AUTH_PROBLEM(Fix.PAIR),
    RESTORED(Fix.SEND_NOW),
    STORAGE_CRITICAL(Fix.STORAGE_SETTINGS),
    STORAGE_LOW(Fix.STORAGE_SETTINGS),
    NEEDS_ATTENTION(Fix.OPEN_SHIFTS),
}

data class Banner(
    val kind: BannerKind,
    val color: StatusColor,
    val unsentShifts: Int,
    val unsentFixes: Long,
    /** Whole days since the oldest thing waiting; null when nothing waits. */
    val oldestDays: Long?,
    /** The unsynced reminder's level (3 days, stronger from 7); NONE: no reminder line. */
    val reminder: Reminder.Level,
    val progress: Progress?,
)

object Banners {
    private const val DAY = 86_400_000L

    fun of(s: SendStatus, now: Long): Banner {
        val sync = s.sync
        val running = s.progress.phase == Progress.Phase.RUNNING && s.progress.shiftsTotal > 0
        val kind = when (sync.message) {
            StatusMessage.WRONG_SERVER -> BannerKind.WRONG_SERVER
            StatusMessage.REVOKED -> BannerKind.REVOKED
            StatusMessage.AUTH_PROBLEM -> BannerKind.AUTH_PROBLEM
            StatusMessage.RESTORED -> BannerKind.RESTORED
            StatusMessage.STORAGE_CRITICAL -> BannerKind.STORAGE_CRITICAL
            StatusMessage.STORAGE_LOW -> BannerKind.STORAGE_LOW
            StatusMessage.NEEDS_ATTENTION -> BannerKind.NEEDS_ATTENTION
            StatusMessage.OFFLINE -> if (running) BannerKind.SENDING else BannerKind.OFFLINE
            null -> when {
                sync.halt == HaltReason.WRONG_SERVER -> BannerKind.WRONG_SERVER
                running -> BannerKind.SENDING
                sync.unsentShifts > 0 || sync.unsentFixes > 0 -> BannerKind.WAITING
                else -> BannerKind.ALL_SENT
            }
        }
        // The banner's reminder line shows whenever one is due by age; the OS notification keeps the once-a-day rhythm.
        val reminder = Reminder.dueAt(sync.oldestAt, sync.unsentShifts, now, null).level
        return Banner(
            kind = kind,
            color = sync.color,
            unsentShifts = sync.unsentShifts,
            unsentFixes = sync.unsentFixes,
            oldestDays = sync.oldestAt?.let { maxOf(0, (now - it) / DAY) },
            reminder = reminder,
            progress = s.progress.takeIf { running },
        )
    }
}

/** One step of "Finish setting up", from the phone's real state. */
enum class SetupStep(val fix: Fix) {
    LOCATION(Fix.APP_SETTINGS),
    ALWAYS(Fix.APP_SETTINGS),
    NOTIFICATIONS(Fix.NOTIFICATIONS),
    // The permissions screen says why first (phone makers stop apps), then opens the list.
    BATTERY(Fix.APP_SETTINGS),
}

data class SetupItem(val step: SetupStep, val done: Boolean)

object Setup {
    /** The checklist; the card hides itself when every step is done. */
    fun of(perm: TrackingPermissionState): List<SetupItem> = listOf(
        SetupItem(SetupStep.LOCATION, perm.preciseLocation),
        SetupItem(SetupStep.ALWAYS, perm.preciseLocation && perm.backgroundLocation),
        SetupItem(SetupStep.NOTIFICATIONS, perm.notifications),
        SetupItem(SetupStep.BATTERY, perm.ignoringBatteryOptimizations),
    )

    fun unfinished(items: List<SetupItem>): Boolean = items.any { !it.done }
}

/** The odometer question: at the start of a shift when a check is due, or at its end. */
sealed interface OdometerAsk {
    val vehicleId: Long

    /** Before starting: the reading goes in as the shift's start reading. Skip starts without one. */
    data class AtStart(override val vehicleId: Long) : OdometerAsk

    /** After the end: the reading is the end reading of [clientId]. */
    data class AtEnd(val clientId: String, override val vehicleId: Long) : OdometerAsk
}
