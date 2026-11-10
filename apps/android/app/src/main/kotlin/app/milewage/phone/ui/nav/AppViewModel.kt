package app.milewage.phone.ui.nav

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingStatus
import app.milewage.phone.logic.Gate
import app.milewage.phone.logic.Gates
import app.milewage.phone.model.PairingPort
import app.milewage.phone.model.ShiftData
import app.milewage.phone.platform.PairLinkInbox
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** What the shell shows: the [gate], and the pairing status (a re-pair mid-shift keeps the gate at MAIN). */
data class ShellState(val gate: Gate, val status: PairingStatus = PairingStatus.UNPAIRED)

/** The shell's state: the gate and the pairing link waiting to be acted on. */
class AppViewModel(
    data: ShiftData,
    pairing: PairingPort,
    private val links: PairLinkInbox,
) : ViewModel() {
    val shell: StateFlow<ShellState> = combine(
        data.pairingStatus(),
        data.runningShift().map { it != null }.distinctUntilChanged(),
        pairing.setupPending(),
    ) { status, running, setup -> ShellState(Gates.of(status, running, setup), status) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, ShellState(Gate.LOADING))

    val link: StateFlow<LinkDecision?> = links.pending

    fun consumeLink() = links.consume()
}
