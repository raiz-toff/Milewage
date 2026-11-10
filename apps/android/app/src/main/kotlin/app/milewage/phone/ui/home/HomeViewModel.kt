package app.milewage.phone.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.format.parseDistance
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.HomeSummary
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.StartResult
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.Reminder
import app.milewage.data.RunningShiftView
import app.milewage.phone.logic.Banner
import app.milewage.phone.logic.Banners
import app.milewage.phone.logic.EditOutcome
import app.milewage.phone.logic.OdometerAsk
import app.milewage.phone.logic.Setup
import app.milewage.phone.logic.SetupItem
import app.milewage.phone.logic.StartGate
import app.milewage.phone.logic.StartProblem
import app.milewage.phone.logic.TrackingLine
import app.milewage.phone.logic.TrackingLines
import app.milewage.phone.logic.VehicleChoice
import app.milewage.phone.logic.VehicleSource
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.Now
import app.milewage.phone.model.ShiftData
import app.milewage.phone.model.TrackingView
import app.milewage.tracking.TrackingPermissionState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

enum class Period { DAY, WEEK, MONTH }

enum class Busy { START, END }

/** Everything Home shows, from the data, the tracker and what the driver did on this screen. */
data class HomeState(
    val ready: Boolean = false,
    val settings: DisplaySettings = DisplaySettings(),
    val pairing: PairingStatus = PairingStatus.PAIRED,
    val summary: HomeSummary? = null,
    val period: Period = Period.WEEK,
    /** The running shift, or null: Home then shows the next shift and Start shift. */
    val running: RunningShiftView? = null,
    val trackingLine: TrackingLine? = null,
    val banner: Banner? = null,
    val vehicles: VehicleChoice = VehicleChoice(),
    val setup: List<SetupItem> = emptyList(),
    val busy: Busy? = null,
    val odometer: OdometerAsk? = null,
    val refreshing: Boolean = false,
    val sending: Boolean = false,
    /** Shifts recorded for another server, never sent there: a card with its two ways forward. */
    val otherServer: OtherServerShifts = OtherServerShifts.NONE,
)

/** One-off messages for a snackbar. */
sealed interface HomeEvent {
    data class StartRefused(val problem: StartProblem) : HomeEvent

    /** [sent]: it reached the server already; otherwise it waits on the phone. */
    data class Ended(val clientId: String, val sent: Boolean) : HomeEvent

    data object EndFailed : HomeEvent

    data object ResumeFailed : HomeEvent

    data object OdometerSaved : HomeEvent

    data object OdometerInvalid : HomeEvent

    data class OdometerRefused(val outcome: EditOutcome) : HomeEvent

    /** After a pull to refresh or Send now: something is still only on the phone. */
    data object StillWaiting : HomeEvent

    /** The driver deleted another server's shifts from the phone. */
    data class OtherServerDeleted(val shifts: Int) : HomeEvent

    data object DeleteFailed : HomeEvent
}

private data class Local(
    val period: Period = Period.WEEK,
    val vehicles: VehicleChoice = VehicleChoice(),
    val busy: Busy? = null,
    val odometer: OdometerAsk? = null,
    val refreshing: Boolean = false,
    val sending: Boolean = false,
    /** The tracker was asked to resume since the screen opened: "not recording" is real. */
    val checked: Boolean = false,
    val permissions: TrackingPermissionState? = null,
)

/**
 * Home: the summary, the sync banner, the setup checklist, the vehicle and Start shift; while a shift
 * runs, the running shift with End shift. Every decision is in `logic/` (tested on the JVM); this
 * collects the flows into one [HomeState] and runs the driver's actions.
 */
class HomeViewModel(
    private val data: ShiftData,
    private val tracking: TrackingView,
    private val now: Now,
) : ViewModel() {
    private val local = MutableStateFlow(Local())
    private val events = Channel<HomeEvent>(Channel.BUFFERED)
    private var reminderNoted = false

    val event: Flow<HomeEvent> = events.receiveAsFlow()

    private val inputs = combine(data.settings(), data.pairingStatus(), data.homeSummary(), data.syncStatus(), data.otherServer()) { s, p, sum, sync, other ->
        Inputs(s, p, sum, Banners.of(sync, now.ms()), other)
    }

    private data class Inputs(
        val settings: DisplaySettings,
        val pairing: PairingStatus,
        val summary: HomeSummary,
        val banner: Banner,
        val otherServer: OtherServerShifts,
    )

    val state: StateFlow<HomeState> = combine(inputs, data.runningShift(), tracking.status, local) { i, running, status, l ->
        val perm = l.permissions ?: tracking.permissions()
        HomeState(
            ready = true,
            settings = i.settings,
            pairing = i.pairing,
            summary = i.summary,
            period = l.period,
            running = running,
            trackingLine = running?.let { TrackingLines.of(it.shift, status, perm, i.settings.tracking, l.checked) },
            banner = i.banner,
            vehicles = l.vehicles,
            setup = Setup.of(perm),
            busy = l.busy,
            odometer = l.odometer,
            refreshing = l.refreshing,
            sending = l.sending,
            otherServer = i.otherServer,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeState())

    init {
        viewModelScope.launch {
            data.vehicles().collect { list ->
                val last = safely { data.lastVehicleId() }
                val default = data.settings().first().defaultVehicleId
                local.update { l ->
                    l.copy(vehicles = l.vehicles.copy(vehicles = list, selectedId = VehicleChoice.pick(list, l.vehicles.selectedId, last, default)))
                }
            }
        }
        viewModelScope.launch { loadVehicles() }
    }

    /** The screen came to the front: read the permissions again (they change in the phone's settings) and resume a lost recording. */
    fun onResume() {
        local.update { it.copy(permissions = tracking.permissions()) }
        viewModelScope.launch {
            safely { tracking.ensureRunning() }
            local.update { it.copy(checked = true, permissions = tracking.permissions()) }
        }
    }

    fun selectPeriod(p: Period) = local.update { it.copy(period = p) }

    fun selectVehicle(id: Long) = local.update { it.copy(vehicles = it.vehicles.copy(selectedId = id)) }

    fun loadVehicles() {
        viewModelScope.launch {
            val list = safely { data.refreshVehicles() }
            local.update { l ->
                val vehicles = list?.vehicles ?: l.vehicles.vehicles
                val source = when {
                    list == null -> VehicleSource.KEPT
                    list.offline -> VehicleSource.KEPT
                    else -> VehicleSource.SERVER
                }
                l.copy(vehicles = l.vehicles.copy(vehicles = vehicles, source = source, selectedId = VehicleChoice.pick(vehicles, l.vehicles.selectedId, null, null)))
            }
        }
    }

    /** "Start shift": the checks, then the odometer question when a check is due, then the start. */
    fun start() {
        val s = state.value
        if (s.busy != null || s.running != null) return
        val perm = tracking.permissions()
        local.update { it.copy(permissions = perm) }
        StartGate.check(perm, s.settings.tracking, s.pairing, s.vehicles)?.let { return refuse(it) }
        val vehicle = s.vehicles.selectedId ?: return
        viewModelScope.launch {
            local.update { it.copy(busy = Busy.START) }
            if (safely { data.odometerDue(vehicle) } == true) {
                local.update { it.copy(busy = null, odometer = OdometerAsk.AtStart(vehicle)) }
            } else {
                begin(vehicle, null)
            }
        }
    }

    private suspend fun begin(vehicle: Long, odometerM: Long?) {
        local.update { it.copy(busy = Busy.START, odometer = null) }
        val r = safely { data.startShift(vehicle, odometerM) }
        local.update { it.copy(busy = null) }
        when (r) {
            is StartResult.Started, is StartResult.AlreadyRunning -> local.update { it.copy(checked = true) }
            StartResult.NotPaired -> refuse(StartProblem.NOT_PAIRED)
            StartResult.RecorderRefused -> refuse(StartProblem.TRACKER_REFUSED)
            null -> refuse(StartProblem.FAILED)
        }
    }

    private fun refuse(p: StartProblem) {
        events.trySend(HomeEvent.StartRefused(p))
    }

    /** "End shift" (after its confirm): ends, tries to send at once, then the odometer question when due. */
    fun end() {
        val running = state.value.running ?: return
        if (state.value.busy != null) return
        viewModelScope.launch {
            local.update { it.copy(busy = Busy.END) }
            val r = safely { data.endShift() }
            if (r is EndResult.Ended) {
                ended(r, running.shift.vehicleId)
            } else if (r == null) {
                events.trySend(HomeEvent.EndFailed)
            }
            local.update { it.copy(busy = null) }
        }
    }

    /** "End it at its last point": a shift the tracker lost, ended where it last recorded. */
    fun closeUnfinished() {
        val running = state.value.running ?: return
        viewModelScope.launch {
            local.update { it.copy(busy = Busy.END) }
            when (val r = safely { data.closeUnfinished() }) {
                is EndResult.Ended -> ended(r, running.shift.vehicleId)
                null -> events.trySend(HomeEvent.EndFailed)
                EndResult.NoShift -> Unit
            }
            local.update { it.copy(busy = null) }
        }
    }

    private suspend fun ended(r: EndResult.Ended, vehicleId: Long) {
        val id = r.shift.clientId
        // The shift is ended and queued whatever happens to the sending; a slow network does not hold the screen.
        val sent = withTimeoutOrNull(SEND_WAIT_MS) { safely { data.sendNow() } } == true
        events.trySend(HomeEvent.Ended(id, sent))
        val hadStart = safely { data.shiftDetail(id).first()?.odometer?.any { it.kind == OdometerKind.SHIFT_START } } == true
        if (hadStart || safely { data.odometerDue(vehicleId) } == true) {
            local.update { it.copy(odometer = OdometerAsk.AtEnd(id, vehicleId)) }
        }
    }

    /** The odometer dialog's Save: the start reading (then the shift starts) or the end reading. */
    fun saveOdometer(text: String) {
        val ask = local.value.odometer ?: return
        val m = parseDistance(text, state.value.settings.unit)
        if (m == null) {
            events.trySend(HomeEvent.OdometerInvalid)
            return
        }
        viewModelScope.launch {
            when (ask) {
                is OdometerAsk.AtStart -> begin(ask.vehicleId, m)
                is OdometerAsk.AtEnd -> {
                    val r = safely { data.setOdometer(ask.clientId, OdometerKind.SHIFT_END, m) }
                    if (r == EditResult.Ok) {
                        safely { data.markOdometerChecked(ask.vehicleId) }
                        local.update { it.copy(odometer = null) }
                        events.trySend(HomeEvent.OdometerSaved)
                    } else {
                        events.trySend(HomeEvent.OdometerRefused(r?.let(EditOutcome::of) ?: EditOutcome.FAILED))
                    }
                }
            }
        }
    }

    /** "Start without it" at the start. */
    fun skipOdometer() {
        val ask = local.value.odometer as? OdometerAsk.AtStart ?: return
        viewModelScope.launch { begin(ask.vehicleId, null) }
    }

    /** Not now / back: at the end it counts as checked, so the prompt stays away until the next one is due. */
    fun dismissOdometer() {
        val ask = local.value.odometer ?: return
        local.update { it.copy(odometer = null) }
        if (ask is OdometerAsk.AtEnd) viewModelScope.launch { safely { data.markOdometerChecked(ask.vehicleId) } }
    }

    fun resumeRecording() {
        val running = state.value.running ?: return
        viewModelScope.launch {
            val ok = safely { tracking.resume(running.shift.clientId, running.shift.startedAt) } == true
            local.update { it.copy(checked = true, permissions = tracking.permissions()) }
            if (!ok) events.trySend(HomeEvent.ResumeFailed)
        }
    }

    /** Pull to refresh: the vehicles and a send round. */
    fun refresh() {
        if (local.value.refreshing) return
        viewModelScope.launch {
            local.update { it.copy(refreshing = true) }
            loadVehicles()
            val done = safely { data.sendNow() } == true
            local.update { it.copy(refreshing = false) }
            if (!done && (state.value.banner?.unsentShifts ?: 0) > 0) events.trySend(HomeEvent.StillWaiting)
        }
    }

    /** The banner's "Send now" and "Check the address": lifts halts and refusals, then a round. */
    fun sendNow() {
        if (local.value.sending) return
        viewModelScope.launch {
            local.update { it.copy(sending = true) }
            val done = safely { data.retrySending() } == true
            local.update { it.copy(sending = false) }
            if (!done) events.trySend(HomeEvent.StillWaiting)
        }
    }

    fun stopSending() = data.cancelSending()

    /** "Delete from this phone" for another server's shifts, after its confirmation. */
    fun deleteOtherServer() {
        viewModelScope.launch {
            val n = safely { data.deleteOtherServerShifts() }
            events.trySend(if (n == null) HomeEvent.DeleteFailed else HomeEvent.OtherServerDeleted(n))
        }
    }

    /** The banner showed the unsynced reminder: it counts as given for the day (the notification waits). */
    fun reminderShown(level: Reminder.Level) {
        if (level == Reminder.Level.NONE || reminderNoted) return
        reminderNoted = true
        viewModelScope.launch { safely { data.reminderShownOnBanner() } }
    }

    private suspend fun <T> safely(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    companion object {
        /** How long "End shift" waits for the first send before saying it is saved on the phone. */
        const val SEND_WAIT_MS = 8_000L
    }
}
