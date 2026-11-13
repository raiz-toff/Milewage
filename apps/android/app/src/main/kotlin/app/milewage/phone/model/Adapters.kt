package app.milewage.phone.model

import app.milewage.core.api.TripKind
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.tracking.TrackingStatus
import app.milewage.data.MileWageData
import app.milewage.tracking.TrackingController
import app.milewage.tracking.TrackingPermissionState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart

/** [ShiftData] on the real facade: every call is the facade's own. */
class MileWageShiftData(private val data: MileWageData) : ShiftData {
    override fun homeSummary() = data.homeSummary()

    override fun runningShift() = data.runningShift()

    override fun shiftList(limit: Int) = data.shiftList(limit)

    override fun shiftDetail(clientId: String) = data.shiftDetail(clientId)

    override fun syncStatus() = data.syncStatus()

    override fun otherServer() = data.otherServer()

    override suspend fun deleteOtherServerShifts() = data.deleteOtherServerShifts()

    override fun vehicles(): Flow<List<VehicleRecord>> = data.vehicles().map { all -> all.filter { it.archivedAt == null } }

    // A send round refreshes the settings (GET /settings first); a pairing change replaces them.
    override fun settings(): Flow<DisplaySettings> =
        combine(data.pairing.statusFlow(), data.syncStatus().map { }.onStart { emit(Unit) }) { _, _ -> }
            .map { DisplaySettings.of(data.pairing.load()?.settings) }
            .distinctUntilChanged()

    override fun pairingStatus(): Flow<PairingStatus> = data.pairing.statusFlow().distinctUntilChanged()

    override fun demo(): Flow<Boolean> = data.demo()

    override suspend fun refreshVehicles() = data.refreshVehicles().let { it.copy(vehicles = it.vehicles.filter { v -> v.archivedAt == null }) }

    override suspend fun lastVehicleId() = data.lastVehicleId()

    override suspend fun startShift(vehicleId: Long, odometerStartM: Long?) = data.startShift(vehicleId, odometerStartM)

    override suspend fun endShift() = data.endShift()

    override suspend fun closeUnfinished() = data.closeUnfinished()

    override suspend fun editTrip(tripKey: String, kind: TripKind?, purpose: String?) = data.editTrip(tripKey, kind, purpose)

    override suspend fun addManualTrip(clientId: String, kind: TripKind, startedAt: Long, endedAt: Long, distanceM: Long, purpose: String?) =
        data.addManualTrip(clientId, kind, startedAt, endedAt, distanceM, purpose)

    override suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long) = data.setOdometer(clientId, kind, readingM)

    override suspend fun setNotes(clientId: String, notes: String) = data.setNotes(clientId, notes)

    override suspend fun markOverwriteSeen(id: Long) = data.markOverwriteSeen(id)

    override suspend fun odometerDue(vehicleId: Long) = data.odometerDue(vehicleId)

    override suspend fun markOdometerChecked(vehicleId: Long) = data.markOdometerChecked(vehicleId)

    override suspend fun sendNow() = data.sendNow()

    override suspend fun retrySending() = data.retrySending()

    override fun cancelSending() = data.cancelSending()

    override suspend fun reminderShownOnBanner() {
        data.reminderShownOnBanner()
    }
}

/** [TrackingView] on the tracking module's controller. */
class ControllerTrackingView(private val c: TrackingController) : TrackingView {
    override val status: StateFlow<TrackingStatus> get() = c.status

    override fun permissions(): TrackingPermissionState = c.permissions()

    override suspend fun ensureRunning(): Boolean = c.ensureRunning()

    override suspend fun resume(shiftClientId: String, startedAt: Long): Boolean =
        c.startShift(shiftClientId, startedAt) == TrackingController.StartResult.STARTED
}
