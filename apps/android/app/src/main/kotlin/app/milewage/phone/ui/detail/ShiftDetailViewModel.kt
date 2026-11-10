package app.milewage.phone.ui.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.core.format.parseDistance
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.ShiftModel
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.TripRecord
import app.milewage.data.ShiftDetail
import app.milewage.phone.logic.EditOutcome
import app.milewage.phone.logic.OverwriteText
import app.milewage.phone.logic.Overwrites
import app.milewage.phone.logic.ShiftFlag
import app.milewage.phone.logic.ShiftFlags
import app.milewage.phone.logic.TripChoice
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.ShiftData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DetailState(
    val loaded: Boolean = false,
    val settings: DisplaySettings = DisplaySettings(),
    /** Null once loaded: the shift is no longer on this phone. */
    val detail: ShiftDetail? = null,
    val flags: List<ShiftFlag> = emptyList(),
    val overwrites: List<OverwriteText> = emptyList(),
    val sending: Boolean = false,
) {
    /** Stops and the estimated split: the server's setting now and the shift's own segmenter. */
    val estimated: Boolean get() = settings.stops && detail?.shift?.segmenter == app.milewage.core.api.Segmenter.STOPS

    /** Trips, odometer and notes can be changed: ended (not running, not finalized on the server). */
    val editable: Boolean get() = detail?.shift?.status == ShiftStatus.ENDED
}

/** What a saved edit was, for the snackbar. */
enum class EditWhat { TRIP_CHANGED, TRIP_ADDED, ODOMETER, NOTES }

sealed interface DetailEvent {
    data class Saved(val what: EditWhat) : DetailEvent

    data class Refused(val outcome: EditOutcome) : DetailEvent

    data object DistanceInvalid : DetailEvent

    data object OdometerInvalid : DetailEvent

    data object PurposeInvalid : DetailEvent

    data object StillWaiting : DetailEvent
}

/** One shift from the phone's database: totals, route, trips and their edits, stops, odometer, notes. */
class ShiftDetailViewModel(private val clientId: String, private val data: ShiftData) : ViewModel() {
    private val sending = MutableStateFlow(false)
    private val events = Channel<DetailEvent>(Channel.BUFFERED)
    val event: Flow<DetailEvent> = events.receiveAsFlow()

    val state: StateFlow<DetailState> = combine(data.settings(), data.shiftDetail(clientId), sending) { s, d, busy ->
        DetailState(
            loaded = true,
            settings = s,
            detail = d,
            flags = d?.shift?.let(ShiftFlags::of) ?: emptyList(),
            overwrites = d?.overwrites?.map(Overwrites::of) ?: emptyList(),
            sending = busy,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DetailState())

    /** A trip's purpose (business or personal) and its description. Never its distance. */
    fun editTrip(trip: TripRecord, choice: TripChoice, purpose: String) {
        val p = ShiftModel.purposeOf(purpose) ?: return run { events.trySend(DetailEvent.PurposeInvalid) }
        edit(EditWhat.TRIP_CHANGED) { data.editTrip(trip.tripKey, TripChoice.kindFor(choice, trip.kind), p) }
    }

    /** A trip the phone missed, at the end of the shift; without a purpose it is "Business driving" (the server needs one). */
    fun addTrip(distanceText: String, choice: TripChoice, purpose: String) {
        val shift = state.value.detail?.shift ?: return
        val m = parseDistance(distanceText, state.value.settings.unit)
        if (m == null || m <= 0) return run { events.trySend(DetailEvent.DistanceInvalid) }
        val p = purpose.trim().ifEmpty { null }
        if (p != null && ShiftModel.purposeOf(p) == null) return run { events.trySend(DetailEvent.PurposeInvalid) }
        val at = shift.endedAt ?: shift.startedAt
        edit(EditWhat.TRIP_ADDED) { data.addManualTrip(clientId, choice.kind, at, at, m, p) }
    }

    fun setOdometer(kind: OdometerKind, text: String) {
        val m = parseDistance(text, state.value.settings.unit) ?: return run { events.trySend(DetailEvent.OdometerInvalid) }
        edit(EditWhat.ODOMETER) { data.setOdometer(clientId, kind, m) }
    }

    fun setNotes(text: String) = edit(EditWhat.NOTES) { data.setNotes(clientId, text.trim()) }

    fun dismissOverwrite(id: Long) {
        viewModelScope.launch { runCatching { data.markOverwriteSeen(id) } }
    }

    /** "Send now": lifts refusals and halts, then a round. */
    fun sendNow() {
        if (sending.value) return
        viewModelScope.launch {
            sending.value = true
            val done = attempt { data.retrySending() } == true
            sending.value = false
            if (!done) events.trySend(DetailEvent.StillWaiting)
        }
    }

    private fun edit(what: EditWhat, block: suspend () -> EditResult) {
        viewModelScope.launch {
            val r = attempt(block)
            events.trySend(
                when (r) {
                    null -> DetailEvent.Refused(EditOutcome.FAILED)
                    EditResult.Ok -> DetailEvent.Saved(what)
                    is EditResult.Refused -> DetailEvent.Refused(EditOutcome.of(r))
                },
            )
        }
    }

    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}
