package app.milewage.phone.ui.firstrun

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.shift.VehicleRecord
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectInput
import app.milewage.phone.logic.Hosts
import app.milewage.phone.logic.LinkFailure
import app.milewage.phone.logic.Nearby
import app.milewage.phone.logic.ServerFacts
import app.milewage.phone.model.NetView
import app.milewage.phone.model.PairingPort
import app.milewage.phone.model.ShiftData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Connect's state: the servers on this Wi-Fi, a connection running, its failure, a link to confirm. */
data class ConnectState(
    val nearby: Nearby = Nearby.Looking,
    val busy: Boolean = false,
    val error: ConnectError? = null,
    /** A pairing link that opened the app: "Connect to this server?" first (anyone can make such a link). */
    val confirm: PairingLink? = null,
)

sealed interface ConnectEvent {
    /** A server address was typed: link with a code there. */
    data class OpenLink(val url: String, val name: String) : ConnectEvent
}

/**
 * Connect (24 section 4.2, screen 4; plan 28): the servers announced on this Wi-Fi, a pairing code
 * from the scanner, the field or a link that opened the app, and a typed server address. Pairing
 * changes the gate, and the shell moves to the setup steps by itself. Shared by Connect and Scan
 * (scoped to the first-run graph), so a scanned code lands here.
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
    private val _events = Channel<ConnectEvent>(Channel.BUFFERED)
    val events: Flow<ConnectEvent> = _events.receiveAsFlow()
    private var again: (() -> Unit)? = null
    private var looking: Job? = null

    init {
        look()
        viewModelScope.launch {
            links.collect { d ->
                if (d is LinkDecision.Ask) {
                    _state.update { it.copy(confirm = d.link) }
                    consumeLink()
                }
            }
        }
    }

    /** "On this Wi-Fi": look for servers (off Wi-Fi it says so; Tailscale is offered there only). */
    fun look() {
        looking?.cancel()
        looking = viewModelScope.launch {
            if (net.localNetworkPermissionNeeded()) {
                _state.update { it.copy(nearby = Nearby.NeedsPermission) }
                return@launch
            }
            _state.update { it.copy(nearby = Nearby.Looking) }
            if (net.localNetwork() == false) {
                val off = !net.tailscaleInstalled() || net.vpnActive() == false
                _state.update { it.copy(nearby = Nearby.OffWifi(off)) }
                return@launch
            }
            val found = try {
                net.discover()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                emptyList()
            }
            _state.update { it.copy(nearby = Nearby.Found(found)) }
        }
    }

    /** A code scanned, pasted or typed, or a server address typed. */
    fun submit(text: String) {
        if (_state.value.busy) return
        when (val input = ConnectInput.read(text, release)) {
            ConnectInput.NotACode -> fail(ConnectError.NotACode)
            is ConnectInput.Refused -> fail(ConnectError.Address(input.problem))
            is ConnectInput.Address -> {
                _state.update { it.copy(error = null) }
                _events.trySend(ConnectEvent.OpenLink(input.url, Hosts.of(input.url) ?: input.url))
            }
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

/** Linking with a code: asking, then the code while the driver types it on the web, or the failure. */
sealed interface LinkState {
    data object Asking : LinkState

    data class Waiting(val code: String) : LinkState

    data class Failed(val failure: LinkFailure) : LinkState
}

/**
 * Link this phone to a server found on the Wi-Fi (plan 28 section 4.5, RFC 8628's device flow): the
 * phone asks, shows the 6-digit code and polls (slower after `slow_down`, until it expires) while
 * the driver types it on the web. Linked: the gate moves on by itself.
 */
class LinkViewModel(private val url: String, private val pairing: PairingPort) : ViewModel() {
    private val _state = MutableStateFlow<LinkState>(LinkState.Asking)
    val state: StateFlow<LinkState> = _state.asStateFlow()
    private var job: Job? = null

    init {
        start()
    }

    /** "Get a new code". */
    fun start() {
        job?.cancel()
        job = viewModelScope.launch {
            _state.value = LinkState.Asking
            try {
                val link = pairing.startLink(url)
                _state.value = LinkState.Waiting(link.userCode)
                pairing.awaitLink(url, link)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = LinkState.Failed(LinkFailure.of(e))
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
