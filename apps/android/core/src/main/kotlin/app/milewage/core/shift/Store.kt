package app.milewage.core.shift

import app.milewage.core.api.ChangeType
import app.milewage.core.api.PointManifest
import app.milewage.core.diagnostics.DiagStore
import app.milewage.core.sync.OutboxCounts
import app.milewage.core.sync.OutboxItem
import app.milewage.core.sync.ResendMark
import app.milewage.core.tracking.FixStore
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.RecordedFix
import kotlinx.serialization.json.JsonObject

/*
 * The storage ports. :data implements all of them on one Room database (`RoomLocalStore`); every
 * write a method makes is committed before it returns, so what the screens show as saved is on disk.
 * Methods are plain reads and writes: every rule (who wins, what is sent when, what may be deleted)
 * is in the callers, in this module.
 */

/** Shifts, their results, odometer readings, vehicles and the overwrite log (15 section 2.2). */
interface ShiftRepository {
    suspend fun shift(clientId: String): ShiftRecord?

    suspend fun shiftByServerId(serverId: Long): ShiftRecord?

    /** The shift with this server id on the server [instanceId] (each server numbers its own shifts). */
    suspend fun shiftByServerId(serverId: Long, instanceId: String?): ShiftRecord?

    /** The running shift (status active), if any; the newest one if a bug ever left two. */
    suspend fun runningShift(): ShiftRecord?

    /** Newest first. */
    suspend fun shifts(limit: Int = 500): List<ShiftRecord>

    /** Shifts not yet sent to the server (on phone only, sending, needs attention), oldest first. */
    suspend fun unsentShifts(): List<ShiftRecord>

    /** Ended or finalized shifts with a local date on or after [fromDate] (`YYYY-MM-DD`), for the summary. */
    suspend fun shiftsFrom(fromDate: String): List<ShiftRecord>

    suspend fun upsertShift(shift: ShiftRecord)

    /** Client ids of the shifts not bound to [instanceId] (another server's, or unbound when it is not null). */
    suspend fun shiftIdsNotBoundTo(instanceId: String?): Set<String>

    /** Binds every unbound shift (recorded before the binding existed) to [instanceId]. Returns how many. */
    suspend fun bindUnbound(instanceId: String): Int

    /**
     * Removes a shift and everything of it on the phone: trips, stops, route, odometer readings,
     * interruptions, its fixes and its resend mark. For a shift the server deleted (the server's
     * delete wins, 15 section 8.4), or one recorded for another server that the driver chose to
     * delete after a confirmation (`ServerBinding.deleteElsewhere`); nothing deletes a shift by itself.
     */
    suspend fun deleteShift(clientId: String)

    suspend fun trips(clientId: String): List<TripRecord>

    suspend fun trip(tripKey: String): TripRecord?

    suspend fun upsertTrip(trip: TripRecord)

    suspend fun deleteTrip(tripKey: String)

    suspend fun stops(clientId: String): List<StopRecord>

    suspend fun route(clientId: String): List<RoutePoint>

    /**
     * The phone's engine result for a shift: replaces its automatic trips, its stops and its route
     * (manual trips stay). One transaction with the caller's shift row update.
     */
    suspend fun replaceResult(clientId: String, trips: List<TripRecord>, stops: List<StopRecord>, route: List<RoutePoint>)

    /** The interruptions kept with an ended shift (the tracker's, copied at the end). */
    suspend fun interruptions(clientId: String): List<Interruption>

    suspend fun replaceInterruptions(clientId: String, list: List<Interruption>)

    suspend fun odometer(clientId: String): List<OdometerRecord>

    suspend fun odometerByServerId(serverId: Long): OdometerRecord?

    /** The reading with this server id, of a shift on the server [instanceId]. */
    suspend fun odometerByServerId(serverId: Long, instanceId: String?): OdometerRecord?

    suspend fun upsertOdometer(reading: OdometerRecord)

    suspend fun deleteOdometer(clientId: String, kind: OdometerKind)

    /** When this vehicle's odometer was last read, on any shift; null when never. */
    suspend fun lastOdometerAt(vehicleId: Long): Long?

    /** Not archived first, then by name. */
    suspend fun vehicles(): List<VehicleRecord>

    suspend fun upsertVehicle(vehicle: VehicleRecord)

    suspend fun deleteVehicle(id: Long)

    suspend fun addOverwrite(entry: OverwriteEntry)

    /** Unseen entries of a shift and of its trips and readings, newest first. */
    suspend fun overwrites(clientId: String): List<OverwriteEntry>

    suspend fun markOverwriteSeen(id: Long)
}

/** The fixes of every shift as sending sees them (the tracker writes through [FixStore]). */
interface FixQueue {
    /** Shifts with fixes not yet accepted by the server, oldest fix first. */
    suspend fun shiftsWithPending(): List<String>

    /** Fixes of [shiftClientId] not yet accepted, in seq order, at most [limit]. */
    suspend fun pending(shiftClientId: String, limit: Int): List<RecordedFix>

    /** Fixes not yet accepted, of one shift or of all. */
    suspend fun pendingCount(shiftClientId: String? = null): Long

    /** The oldest fix time among those not yet accepted; null when none. */
    suspend fun oldestPendingAt(): Long?

    /** Pending to sent, with the acknowledgement time. Returns how many changed. */
    suspend fun markSent(seqs: List<Long>, at: Long): Int

    /** Pending to set aside (the server refused them for good): kept, never sent again, not in results. */
    suspend fun setAside(seqs: List<Long>, reason: String, at: Long): Int

    /** Fixes of a shift above [afterSeq], pending and sent alike, in seq order (the restore resend). */
    suspend fun after(shiftClientId: String, afterSeq: Long, limit: Int): List<RecordedFix>

    /** First and last seq and count of the shift's fixes (set-aside ones left out); null when none. */
    suspend fun manifest(shiftClientId: String): PointManifest?

    /**
     * Deletes sent fixes acknowledged before [sentBefore] whose shift the server has confirmed
     * (sent, nothing of it queued) and that no restore resend still needs. Never a pending fix,
     * never a fix of the running shift. See `Retention`.
     */
    suspend fun evictSent(sentBefore: Long): Int
}

/** The durable queue of changes the server has not acknowledged (08 section 4.1). */
interface OutboxStore {
    suspend fun insertChange(kind: ChangeType, entityKey: String, body: JsonObject, createdAt: Long): Long

    /** Replaces a pending row's body in place (keeps its place and creation time); resets its attempts. */
    suspend fun replaceChange(id: Long, body: JsonObject)

    /** Pending rows of this kind and entity key, newest first. */
    suspend fun pendingIds(kind: ChangeType, entityKey: String): List<Long>

    /** Pending rows in send order (oldest first). */
    suspend fun pendingChanges(): List<OutboxItem>

    suspend fun parkedChanges(): List<OutboxItem>

    suspend fun changeCounts(): OutboxCounts

    /** True when the shift has an unsent row of [kind] (pending or parked). */
    suspend fun hasChange(kind: ChangeType, shiftClientId: String): Boolean

    /** True when the shift has any unsent row. */
    suspend fun hasAnyChange(shiftClientId: String): Boolean

    suspend fun deleteChange(id: Long)

    /** Deletes an answered row only if its body is still [body] (an edit may have replaced it while it was sent). */
    suspend fun deleteSentChange(id: Long, body: JsonObject)

    suspend fun changeFailed(id: Long, error: String)

    suspend fun parkChange(id: Long, error: String)

    /** Parked rows go back to pending (the driver's retry). Returns how many. */
    suspend fun unparkChanges(shiftClientId: String? = null): Int

    /** Removes every row of a shift (the server deleted the shift). */
    suspend fun dropChanges(shiftClientId: String)
}

/** One row per shift the server must be sent again after a restore (15 section 9.3). */
interface ResendStore {
    suspend fun resendMarks(): List<ResendMark>

    suspend fun resendMark(shiftClientId: String): ResendMark?

    /** Writes [mark] for every shift in [shiftClientIds] (insert or replace). */
    suspend fun markForResend(shiftClientIds: List<String>, mark: (String) -> ResendMark)

    /** Writes [next] only if the row still equals [expected]; false when a restore changed it meanwhile. */
    suspend fun swapResendMark(expected: ResendMark, next: ResendMark): Boolean

    /** Deletes the row only if it still equals [expected]. */
    suspend fun dropResendMark(expected: ResendMark): Boolean
}

/** Small values: cursors, the restore generation, last times, reminder state. */
interface Bookkeeping {
    suspend fun get(key: String): String?

    suspend fun put(key: String, value: String)

    suspend fun remove(key: String)
}

/** Everything the phone keeps, in one database, with transactions. */
interface LocalStore : ShiftRepository, FixQueue, OutboxStore, ResendStore, Bookkeeping, DiagStore {
    /** Runs [block] in one write transaction: all of it is committed, or none of it. */
    suspend fun <T> transaction(block: suspend () -> T): T

    /** The fixes table as the tracker writes it. */
    val fixes: FixStore
}
