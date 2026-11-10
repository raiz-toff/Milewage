package app.milewage.phone.ui.nav

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingStatus
import app.milewage.phone.model.ShiftData
import app.milewage.phone.platform.PairLinkInbox
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** Which part of the app shows: first run until the phone is paired, then the app. */
enum class Gate { LOADING, FIRST_RUN, MAIN }

object Gates {
    /**
     * The app for a paired phone. A running shift keeps the app on screen whatever happens to the
     * pairing (a revoke mid-shift: the shift goes on recording, its data waits). [debugUnpaired]: a
     * debug build's way into the app without pairing, until the pairing screens land.
     */
    fun of(status: PairingStatus, running: Boolean, debugUnpaired: Boolean): Gate =
        if (status == PairingStatus.PAIRED || running || debugUnpaired) Gate.MAIN else Gate.FIRST_RUN
}

/** The shell's state: the gate and the pairing link waiting to be acted on. */
class AppViewModel(
    data: ShiftData,
    private val links: PairLinkInbox,
    debugUnpaired: StateFlow<Boolean>,
) : ViewModel() {
    val gate: StateFlow<Gate> = combine(
        data.pairingStatus(),
        data.runningShift().map { it != null }.distinctUntilChanged(),
        debugUnpaired,
    ) { status, running, bypass -> Gates.of(status, running, bypass) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, Gate.LOADING)

    val link: StateFlow<LinkDecision?> = links.pending

    fun consumeLink() = links.consume()
}
