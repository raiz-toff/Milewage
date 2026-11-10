package app.milewage.phone.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.connect.Where
import app.milewage.core.pairing.PairedState
import app.milewage.core.sync.Progress
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectionCheck
import app.milewage.phone.logic.DetectionOutcome
import app.milewage.phone.logic.HelpLinks
import app.milewage.phone.logic.NudgeChoices
import app.milewage.phone.logic.ServerFacts
import app.milewage.phone.logic.checkedUrl
import app.milewage.phone.model.AppearancePort
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.NetView
import app.milewage.phone.model.PairingPort
import app.milewage.phone.model.ShiftData
import app.milewage.phone.model.TrackingSettingsPort
import app.milewage.core.tracking.TrackingSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The app's version facts for About. */
data class AppInfo(val version: String, val build: Int, val engine: Int)

data class SettingsState(
    val facts: ServerFacts? = null,
    val where: Where? = null,
    val check: ConnectionCheck = ConnectionCheck.Checking,
    /** The server's settings, as the numbers are shown (changed on the web). */
    val display: DisplaySettings = DisplaySettings(),
    val unsentShifts: Int = 0,
    val unsentFixes: Long = 0,
    val sending: Boolean = false,
    val running: Boolean = false,
    val detection: Boolean = false,
    val detectionBusy: Boolean = false,
    /** The last refusal of the drive prompt, shown under its switch with its way forward. */
    val detectionProblem: DetectionOutcome? = null,
    val nudgeMs: Long = TrackingSettings.DEFAULT_NUDGE_MS,
    val theme: AppTheme = AppTheme.SYSTEM,
    val wallpaper: Boolean = false,
    /** The server's Help pages, through the address the phone uses now; null when the server turned Help off. */
    val helpBase: String? = null,
)

sealed interface SettingsEvent {
    /** "Connect to a different server?" with the Expo app's words. */
    data class AskUnpair(val host: String) : SettingsEvent

    /** The phone refused: shifts and points are only on this phone. Disconnect anyway? */
    data class AskLoseUnsent(val host: String, val shifts: Int, val fixes: Long) : SettingsEvent

    /** A shift is running: it must end first. */
    data object EndShiftFirst : SettingsEvent

    data object Disconnected : SettingsEvent

    data object DisconnectFailed : SettingsEvent

    /** Send now finished: [done] when nothing is left on the phone only. */
    data class Sent(val done: Boolean) : SettingsEvent

    data class Detection(val outcome: DetectionOutcome) : SettingsEvent
}

/**
 * Settings: the server (host names, connection, Check connection), this phone (connect to another
 * server, refused while unsent data waits unless the driver confirms), tracking (the drive prompt,
 * the "Still on shift?" reminder), appearance, the server's units and formats (read only), sending,
 * Help and About.
 */
class SettingsViewModel(
    private val pairing: PairingPort,
    private val net: NetView,
    private val data: ShiftData,
    private val tracking: TrackingSettingsPort,
    private val appearance: AppearancePort,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()
    private val _events = Channel<SettingsEvent>(Channel.BUFFERED)
    val events: Flow<SettingsEvent> = _events.receiveAsFlow()
    private var paired: PairedState? = null

    init {
        viewModelScope.launch {
            combine(data.settings(), data.syncStatus(), data.runningShift()) { d, s, r -> Triple(d, s, r) }.collect { (d, s, r) ->
                _state.update {
                    it.copy(
                        display = d,
                        unsentShifts = s.sync.unsentShifts,
                        unsentFixes = s.sync.unsentFixes,
                        sending = s.progress.phase == Progress.Phase.RUNNING,
                        running = r != null,
                    )
                }
            }
        }
        viewModelScope.launch { appearance.theme.collect { t -> _state.update { it.copy(theme = t) } } }
        viewModelScope.launch { appearance.wallpaperColours.collect { w -> _state.update { it.copy(wallpaper = w) } } }
        viewModelScope.launch {
            val t = tracking.settings()
            _state.update { it.copy(detection = t.detectionEnabled, nudgeMs = t.nudgeAfterMs) }
        }
        viewModelScope.launch {
            // The server, then a check of the connection (the settings come back fresh with it).
            pairing.status().collect { readServer() }
        }
        check()
    }

    private suspend fun readServer() {
        val p = pairing.paired()
        paired = p
        _state.update {
            it.copy(
                facts = p?.let(ServerFacts::of),
                where = pairing.where(),
                helpBase = p?.takeIf { s -> s.settings?.helpEnabled != false }?.let { s -> HelpLinks.base(s.credential, pairing.where()) },
            )
        }
    }

    /** "Check connection": `GET /settings` through the route the phone uses. */
    fun check() {
        _state.update { it.copy(check = ConnectionCheck.Checking) }
        viewModelScope.launch {
            val failure = pairing.checkConnection()
            readServer()
            val where = pairing.where()
            val result = if (failure == null) {
                ConnectionCheck.Ok(where)
            } else {
                val url = paired?.credential?.checkedUrl(where) ?: ""
                ConnectionCheck.Failed(ConnectError.of(failure, url) { net.vpnActive() })
            }
            _state.update { it.copy(check = result, where = where) }
        }
    }

    fun openTailscale() {
        viewModelScope.launch { net.openTailscale() }
    }

    /** "Connect to a different server": never while a shift runs; asks first. */
    fun disconnect() {
        if (_state.value.running) {
            _events.trySend(SettingsEvent.EndShiftFirst)
            return
        }
        _events.trySend(SettingsEvent.AskUnpair(_state.value.facts?.host ?: ""))
    }

    /** The driver confirmed. Refused while data waits: the second question names it. */
    fun confirmDisconnect(loseUnsent: Boolean = false) {
        viewModelScope.launch {
            val ok = try {
                pairing.unpair(loseUnsent)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                _events.trySend(SettingsEvent.DisconnectFailed)
                return@launch
            }
            if (ok) {
                _events.trySend(SettingsEvent.Disconnected)
            } else {
                val s = _state.value
                _events.trySend(SettingsEvent.AskLoseUnsent(s.facts?.host ?: "", s.unsentShifts, s.unsentFixes))
            }
        }
    }

    /** "Ask to start a shift when I seem to be driving". */
    fun setDetection(on: Boolean) {
        if (_state.value.detectionBusy) return
        _state.update { it.copy(detectionBusy = true, detectionProblem = null) }
        viewModelScope.launch {
            val result = tracking.setDetection(on)
            val perm = tracking.permissions()
            val outcome = DetectionOutcome.of(result, perm.locationEnabled, perm.preciseLocation)
            val enabled = outcome == DetectionOutcome.ON
            _state.update {
                it.copy(
                    detectionBusy = false,
                    detection = if (on) enabled else false,
                    detectionProblem = outcome.takeUnless { o -> o == DetectionOutcome.ON || o == DetectionOutcome.OFF },
                )
            }
            if (outcome != DetectionOutcome.ON && outcome != DetectionOutcome.OFF) _events.trySend(SettingsEvent.Detection(outcome))
        }
    }

    fun setNudge(minutes: Int) {
        val ms = NudgeChoices.ms(minutes)
        viewModelScope.launch {
            tracking.setNudgeAfter(ms)
            _state.update { it.copy(nudgeMs = ms) }
        }
    }

    fun setTheme(theme: AppTheme) {
        viewModelScope.launch { appearance.setTheme(theme) }
    }

    fun setWallpaper(on: Boolean) {
        viewModelScope.launch { appearance.setWallpaperColours(on) }
    }

    fun sendNow() {
        viewModelScope.launch { _events.trySend(SettingsEvent.Sent(data.retrySending())) }
    }

    /** Back on screen: the switches may have changed in the phone's settings. */
    fun onResume() {
        viewModelScope.launch {
            val t = tracking.settings()
            _state.update { it.copy(detection = t.detectionEnabled, nudgeMs = t.nudgeAfterMs) }
        }
    }
}
