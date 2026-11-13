package app.milewage.phone.ui.firstrun

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.shift.VehicleRecord
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectInput
import app.milewage.phone.logic.ServerFacts
import app.milewage.phone.model.NetView
import app.milewage.phone.model.PairingPort
import app.milewage.phone.model.ShiftData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Connect's state: a connection running, its failure, a link to confirm. */
data class ConnectState(
    val busy: Boolean = false,
    val error: ConnectError? = null,
    /** A pairing link that opened the app: "Connect to this server?" first (anyone can make such a link). */
    val confirm: PairingLink? = null,
    /** "Try it without a server" is setting up the demo. */
    val demoBusy: Boolean = false,
    /** The demo could not be set up (the phone's storage): a message with Try again. */
    val demoFailed: Boolean = false,
)

/**
 * Connect (24 section 4.2, screen 4): a pairing code from the scanner, the field or a link that
 * opened the app. Pairing changes the gate, and the shell moves to the setup steps by itself.
 * Shared by Connect and Scan (scoped to the first-run graph), so a scanned code lands here.
 */
class ConnectViewModel(
    private val pairing: PairingPort,
    private val net: NetView,
    private val links: StateFlow<LinkDecision?>,
    private val consumeLink: () -> Unit,
    /** Plain http only to a home address (release builds). */
    private val release: Boolean,
) : ViewModel() {
    private val _state = MutableStateFlow(ConnectState())
    val state: StateFlow<ConnectState> = _state.asStateFlow()
    private var again: (() -> Unit)? = null

    init {
        viewModelScope.launch {
            links.collect { d ->
                if (d is LinkDecision.Ask) {
                    _state.update { it.copy(confirm = d.link) }
                    consumeLink()
                }
            }
        }
    }

    /** A code scanned or pasted. */
    fun submit(text: String) {
        if (_state.value.busy) return
        when (val input = ConnectInput.read(text, release)) {
            ConnectInput.NotACode -> fail(ConnectError.NotACode)
            is ConnectInput.Refused -> fail(ConnectError.Address(input.problem))
            is ConnectInput.Code -> redeem(input.link)
        }
    }

    /** "Yes, connect" to a link that opened the app. Its address is checked like any other code. */
    fun confirmLink() {
        val link = _state.value.confirm ?: return
        _state.update { it.copy(confirm = null) }
        submit(PairingLinks.links(link).first)
    }

    /** "Cancel": nothing is sent. */
    fun cancelLink() = _state.update { it.copy(confirm = null) }

    /** The error's "Try again": the same attempt once more. */
    fun retry() {
        _state.update { it.copy(error = null) }
        again?.invoke()
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun openTailscale() {
        viewModelScope.launch { net.openTailscale() }
    }

    /**
     * "Try it without a server": pairs with the demo server in this process (no network) and adds
     * its sample data. The gate then moves to the setup steps, as after any first connection.
     */
    fun tryDemo() {
        if (_state.value.demoBusy || _state.value.busy) return
        _state.update { it.copy(demoBusy = true, demoFailed = false) }
        viewModelScope.launch {
            val ok = try {
                pairing.enterDemo()
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                false
            }
            _state.update { it.copy(demoBusy = false, demoFailed = !ok) }
        }
    }

    /** The demo's failure message was shown. */
    fun demoFailureShown() = _state.update { it.copy(demoFailed = false) }

    private fun fail(e: ConnectError) = _state.update { it.copy(error = e) }

    private fun redeem(link: PairingLink) {
        again = { redeem(link) }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                pairing.redeem(link) // lifts every halt; the gate moves on by itself
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(ConnectError.of(e, link.baseUrl) { net.vpnActive() })
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}

/** Tailscale on this phone: installed, and its VPN on (null: Android could not say). */
data class TailscaleState(val installed: Boolean, val on: Boolean?) {
    val ready: Boolean get() = installed && on == true
}

class TailscaleViewModel(private val net: NetView) : ViewModel() {
    private val _state = MutableStateFlow<TailscaleState?>(null)
    val state: StateFlow<TailscaleState?> = _state.asStateFlow()

    /** On open and on every return from Tailscale or the app store. */
    fun refresh() {
        viewModelScope.launch { _state.value = TailscaleState(net.tailscaleInstalled(), net.vpnActive()) }
    }

    fun open() {
        viewModelScope.launch { net.openTailscale() }
    }
}

/** What the server sent when the phone connected; [vehicles] null: the list could not be loaded. */
data class SetupState(
    val facts: ServerFacts? = null,
    val vehicles: List<VehicleRecord>? = null,
    val checking: Boolean = true,
)

/**
 * The setup steps after a first connection (24 section 4.2, screens 5 to 10): Connected (what the
 * server sent, the vehicles, Check again), the permissions, then Ready, whose button finishes setup
 * and lets the gate show Home. Scoped to the setup graph.
 */
class SetupViewModel(private val pairing: PairingPort, private val data: ShiftData) : ViewModel() {
    private val _state = MutableStateFlow(SetupState())
    val state: StateFlow<SetupState> = _state.asStateFlow()

    init {
        load()
    }

    /** "Check again" (after adding a vehicle on the web). */
    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(checking = true) }
            val facts = pairing.paired()?.let(ServerFacts::of)
            val vehicles = try {
                val list = data.refreshVehicles()
                list.vehicles.takeUnless { list.offline && it.isEmpty() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            _state.value = SetupState(facts, vehicles, checking = false)
        }
    }

    /** Ready > Go to home. */
    fun finish() {
        viewModelScope.launch { pairing.finishSetup() }
    }
}
