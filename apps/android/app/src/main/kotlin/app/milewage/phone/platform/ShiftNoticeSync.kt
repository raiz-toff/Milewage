package app.milewage.phone.platform

import app.milewage.core.tracking.NoticeShiftRow
import app.milewage.core.tracking.shiftNotice
import app.milewage.data.MileWageData
import app.milewage.phone.model.DisplaySettings
import app.milewage.tracking.TrackingController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps the running-shift notification's fixed parts in step (`TrackingController.setNotice`): the
 * start time and vehicle, and today's earlier shifts, in the driver's unit, zone and clock. The
 * tracker counts the distance itself as fixes arrive.
 */
class ShiftNoticeSync(
    private val data: MileWageData,
    private val tracking: TrackingController,
    private val settings: Flow<DisplaySettings>,
) {
    private data class Key(val clientId: String, val startedAt: Long, val localDate: String, val vehicle: String?)

    @OptIn(ExperimentalCoroutinesApi::class)
    fun start(scope: CoroutineScope) {
        scope.launch {
            val running = data.runningShift()
                .map { r -> r?.let { Key(it.shift.clientId, it.shift.startedAt, it.shift.localDate, it.vehicle?.name) } }
                .distinctUntilChanged()
            combine(running, settings) { k, s -> k to s }.collectLatest { (k, s) ->
                if (k == null) return@collectLatest
                runCatching {
                    val rows = data.store.shiftsFrom(k.localDate).map {
                        NoticeShiftRow(it.clientId, it.localDate, it.status.wire, it.distances?.totalM)
                    }
                    tracking.setNotice(shiftNotice(k.clientId, k.startedAt, k.vehicle, rows, s.unit, s.timezone, s.timeFormat))
                }
            }
        }
    }
}
