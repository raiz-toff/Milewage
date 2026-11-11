package app.milewage.phone.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.connect.Where
import app.milewage.core.pairing.PairedState
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.Progress
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectionCheck
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
    val nudgeMs: Long = TrackingSettings.DEFAULT_NUDGE_MS,
    val theme: AppTheme = AppTheme.SYSTEM,
    val wallpaper: Boolean = false,
    /** The server's Help pages, through the address the phone uses now; null when the server turned Help off. */
    val helpBase: String? = null,
    /** Shifts recorded for another server, never sent there. */
    val otherServer: OtherServerShifts = OtherServerShifts.NONE,
)

sealed interface SettingsEvent {
    /** "Connect to a different server?" with the Expo app's words. */
    data class AskUnpair(val host: String) : SettingsEvent

    /** Shifts for this server are only on this phone: they stay, and go only to this server. Disconnect anyway? */
    data class AskLeaveUnsent(val host: String, val shifts: Int, val fixes: Long) : SettingsEvent

    /** A shift is running: it must end first. */
    data object EndShiftFirst : SettingsEvent

    data object Disconnected : SettingsEvent

    data object DisconnectFailed : SettingsEvent

    /** Send now finished: [done] when nothing is left on the phone only. */
    data class Sent(val done: Boolean) : SettingsEvent

    /** The driver deleted another server's shifts from the phone. */
    data class OtherServerDeleted(val shifts: Int) : SettingsEvent

    data object DeleteFailed : SettingsEvent
}

/**
 * Settings: the server (host names, connection, Check connection), this phone (connect to another
 * server, refused while unsent data waits unless the driver confirms), tracking (the "Still on
 * shift?" reminder), appearance, the server's units and formats (read only), sending,
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
        viewModelScope.launch { data.otherServer().collect { o -> _state.update { it.copy(otherServer = o) } } }
        viewModelScope.launch { appearance.theme.collect { t -> _state.update { it.copy(theme = t) } } }
        viewModelScope.launch { appearance.wallpaperColours.collect { w -> _state.update { it.copy(wallpaper = w) } } }
        viewModelScope.launch {
            val t = tracking.settings()
            _state.update { it.copy(nudgeMs = t.nudgeAfterMs) }
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

    /**
     * The driver confirmed. Refused while this server's data waits: the second question names it and
     * says it stays on the phone for this server ([confirmed] after that one).
     */
    fun confirmDisconnect(confirmed: Boolean = false) {
        viewModelScope.launch {
            val ok = try {
                pairing.unpair(confirmed)
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
                _events.trySend(SettingsEvent.AskLeaveUnsent(s.facts?.host ?: "", s.unsentShifts, s.unsentFixes))
            }
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

    /** "Delete from this phone" for another server's shifts, after its confirmation. */
    fun deleteOtherServer() {
        viewModelScope.launch {
            val n = try {
                data.deleteOtherServerShifts()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            _events.trySend(if (n == null) SettingsEvent.DeleteFailed else SettingsEvent.OtherServerDeleted(n))
        }
    }

    fun sendNow() {
        viewModelScope.launch { _events.trySend(SettingsEvent.Sent(data.retrySending())) }
    }

    /** Back on screen: the switches may have changed in the phone's settings. */
    fun onResume() {
        viewModelScope.launch {
            val t = tracking.settings()
            _state.update { it.copy(nudgeMs = t.nudgeAfterMs) }
        }
    }
}
