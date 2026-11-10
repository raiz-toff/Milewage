package app.milewage.phone.ui.shifts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.milewage.phone.logic.ShiftGroup
import app.milewage.phone.logic.ShiftGroups
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.Formats
import app.milewage.phone.model.Now
import app.milewage.phone.model.ShiftData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ShiftsState(
    val loaded: Boolean = false,
    val settings: DisplaySettings = DisplaySettings(),
    val groups: List<ShiftGroup> = emptyList(),
    /** More shifts are on the phone than shown: "Show older shifts" raises the limit. */
    val hasMore: Boolean = false,
    val refreshing: Boolean = false,
)

sealed interface ShiftsEvent {
    /** After a pull to refresh: some shifts are still only on this phone. */
    data object StillWaiting : ShiftsEvent
}

/** Every shift on this phone, newest first, in weeks. Works offline: it reads the database. */
@OptIn(ExperimentalCoroutinesApi::class)
class ShiftsViewModel(private val data: ShiftData, private val now: Now) : ViewModel() {
    private val limit = MutableStateFlow(PAGE)
    private val refreshing = MutableStateFlow(false)
    private val events = Channel<ShiftsEvent>(Channel.BUFFERED)

    val event: Flow<ShiftsEvent> = events.receiveAsFlow()

    val state: StateFlow<ShiftsState> = combine(
        data.settings(),
        limit.flatMapLatest { n -> data.shiftList(n).map { it to n } },
        refreshing,
    ) { s, (items, n), r ->
        val today = Formats(s).dayOf(now.ms())
        ShiftsState(true, s, ShiftGroups.of(items, today, s.weekStart), hasMore = items.size >= n, refreshing = r)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ShiftsState())

    fun showOlder() = limit.update { it + PAGE }

    /** Pull to refresh: a send round (what waits goes, the server's changes come). */
    fun refresh() {
        if (refreshing.value) return
        viewModelScope.launch {
            refreshing.value = true
            val done = try {
                data.sendNow()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                false
            }
            refreshing.value = false
            if (!done) events.trySend(ShiftsEvent.StillWaiting)
        }
    }

    companion object {
        /** The facade's page (`shiftList(limit = 200)`). */
        const val PAGE = 200
    }
}
