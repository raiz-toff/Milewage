package app.milewage.phone.model

import app.milewage.core.api.TripKind
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.HomeSummary
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.StartResult
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.SendStatus
import app.milewage.core.tracking.TrackingStatus
import app.milewage.data.RunningShiftView
import app.milewage.data.ShiftDetail
import app.milewage.data.ShiftListItem
import app.milewage.data.VehicleList
import app.milewage.tracking.TrackingPermissionState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * What the screens read and do, as the view models see it: a thin seam over `MileWageData` (see
 * [MileWageShiftData]) so every view model is tested on the JVM with a fake. Each member is the
 * facade's own (data/README.md), plus [settings] and [pairingStatus].
 */
interface ShiftData {
    fun homeSummary(): Flow<HomeSummary>

    fun runningShift(): Flow<RunningShiftView?>

    /** Newest first; at most [limit] (the list pages by raising it). */
    fun shiftList(limit: Int): Flow<List<ShiftListItem>>

    fun shiftDetail(clientId: String): Flow<ShiftDetail?>

    fun syncStatus(): Flow<SendStatus>

    /** Shifts recorded for another server and never sent there (they go only to that server). */
    fun otherServer(): Flow<OtherServerShifts>

    /** Deletes [otherServer]'s shifts from the phone, after the driver confirmed. Returns how many. */
    suspend fun deleteOtherServerShifts(): Int

    fun vehicles(): Flow<List<VehicleRecord>>

    /** The cached server settings the numbers are shown in; re-read after every send round and pairing change. */
    fun settings(): Flow<DisplaySettings>

    fun pairingStatus(): Flow<PairingStatus>

    suspend fun refreshVehicles(): VehicleList

    suspend fun lastVehicleId(): Long?

    suspend fun startShift(vehicleId: Long, odometerStartM: Long?): StartResult

    suspend fun endShift(): EndResult

    suspend fun closeUnfinished(): EndResult

    suspend fun editTrip(tripKey: String, kind: TripKind?, purpose: String?): EditResult

    suspend fun addManualTrip(clientId: String, kind: TripKind, startedAt: Long, endedAt: Long, distanceM: Long, purpose: String?): EditResult

    suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long): EditResult

    suspend fun setNotes(clientId: String, notes: String): EditResult

    suspend fun markOverwriteSeen(id: Long)

    suspend fun odometerDue(vehicleId: Long): Boolean

    suspend fun markOdometerChecked(vehicleId: Long)

    /** True when nothing is left on the phone only. */
    suspend fun sendNow(): Boolean

    /** "Send now" / "Check the address": lifts halts and refusals, then a round. */
    suspend fun retrySending(): Boolean

    fun cancelSending()

    suspend fun reminderShownOnBanner()
}

/** The tracker as the screens need it (over `TrackingController`). */
interface TrackingView {
    /** Never holds a coordinate. */
    val status: StateFlow<TrackingStatus>

    /** What the phone allows now (reads, never asks). */
    fun permissions(): TrackingPermissionState

    /** Restarts a shift or detection that should run and does not; false when it still cannot. */
    suspend fun ensureRunning(): Boolean

    /** Starts recording [shiftClientId] again (a no-op when it already records); false when Android refused. */
    suspend fun resume(shiftClientId: String, startedAt: Long): Boolean
}

/** The phone's clock, for the elapsed time and the banner's day counts (a fake in tests). */
fun interface Now {
    fun ms(): Long

    companion object {
        val SYSTEM = Now { System.currentTimeMillis() }
    }
}
