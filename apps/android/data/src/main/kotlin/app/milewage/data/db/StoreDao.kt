package app.milewage.data.db

import androidx.room3.ColumnInfo
import androidx.room3.Dao
import androidx.room3.Insert
import androidx.room3.Query
import androidx.room3.Transaction
import androidx.room3.Update

/** First and last seq and count of a shift's fixes (null fields: none). */
data class ManifestRow(
    @ColumnInfo(name = "first_seq") val first: Long?,
    @ColumnInfo(name = "last_seq") val last: Long?,
    @ColumnInfo(name = "n") val n: Long,
)

data class OutboxCountRow(
    @ColumnInfo(name = "p") val pending: Int?,
    @ColumnInfo(name = "k") val parked: Int?,
    @ColumnInfo(name = "o") val oldestAt: Long?,
)

/** Every query of the store. Each statement is its own transaction unless the caller opened one. */
@Dao
interface StoreDao {
    // Shifts ----------------------------------------------------------------------------------

    @Query("SELECT * FROM shifts WHERE client_id = :id")
    suspend fun shift(id: String): ShiftEntity?

    @Query("SELECT * FROM shifts WHERE server_id = :serverId ORDER BY started_at DESC LIMIT 1")
    suspend fun shiftByServerId(serverId: Long): ShiftEntity?

    @Query("SELECT * FROM shifts WHERE instance_id IS :instance AND server_id = :serverId")
    suspend fun shiftByServerIdOn(serverId: Long, instance: String?): ShiftEntity?

    @Query("SELECT * FROM shifts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1")
    suspend fun runningShift(): ShiftEntity?

    @Query("SELECT * FROM shifts ORDER BY started_at DESC LIMIT :limit")
    suspend fun shifts(limit: Int): List<ShiftEntity>

    @Query("SELECT * FROM shifts WHERE sync_state <> 'on_server' ORDER BY started_at")
    suspend fun unsentShifts(): List<ShiftEntity>

    @Query("SELECT * FROM shifts WHERE status <> 'active' AND local_date >= :from ORDER BY local_date, started_at")
    suspend fun shiftsFrom(from: String): List<ShiftEntity>

    @Insert
    suspend fun insertShift(e: ShiftEntity)

    @Update
    suspend fun updateShift(e: ShiftEntity): Int

    /** Update, else insert. (Room's @Upsert tells a conflict by the exception's message, which the JVM tests' SQLite stub drops.) */
    @Transaction
    suspend fun upsertShift(e: ShiftEntity) {
        if (updateShift(e) == 0) insertShift(e)
    }

    @Query("DELETE FROM shifts WHERE client_id = :id")
    suspend fun deleteShift(id: String)

    /** `IS NOT`: null-safe, so with a null instance it is every bound shift, and with one it includes the unbound. */
    @Query("SELECT client_id FROM shifts WHERE instance_id IS NOT :instance")
    suspend fun shiftIdsNotBoundTo(instance: String?): List<String>

    @Query("UPDATE shifts SET instance_id = :instance WHERE instance_id IS NULL")
    suspend fun bindUnbound(instance: String): Int

    // Results ---------------------------------------------------------------------------------

    @Query("SELECT * FROM trips WHERE shift_client_id = :id ORDER BY started_at, trip_key")
    suspend fun trips(id: String): List<TripEntity>

    @Query("SELECT * FROM trips WHERE trip_key = :key")
    suspend fun trip(key: String): TripEntity?

    @Insert
    suspend fun insertTrip(e: TripEntity)

    @Update
    suspend fun updateTrip(e: TripEntity): Int

    /** Update, else insert. (Room's @Upsert tells a conflict by the exception's message, which the JVM tests' SQLite stub drops.) */
    @Transaction
    suspend fun upsertTrip(e: TripEntity) {
        if (updateTrip(e) == 0) insertTrip(e)
    }

    @Transaction
    suspend fun upsertTrips(t: List<TripEntity>) {
        for (e in t) upsertTrip(e)
    }

    @Query("DELETE FROM trips WHERE trip_key = :key")
    suspend fun deleteTrip(key: String)

    @Query("DELETE FROM trips WHERE shift_client_id = :id AND source = 'auto'")
    suspend fun deleteAutoTrips(id: String)

    @Query("SELECT * FROM stops WHERE shift_client_id = :id ORDER BY started_at")
    suspend fun stops(id: String): List<StopEntity>

    @Insert
    suspend fun insertStops(s: List<StopEntity>)

    @Query("DELETE FROM stops WHERE shift_client_id = :id")
    suspend fun deleteStops(id: String)

    @Query("SELECT * FROM routes WHERE shift_client_id = :id")
    suspend fun route(id: String): RouteEntity?

    @Insert
    suspend fun insertRoute(e: RouteEntity)

    @Update
    suspend fun updateRoute(e: RouteEntity): Int

    /** Update, else insert. (Room's @Upsert tells a conflict by the exception's message, which the JVM tests' SQLite stub drops.) */
    @Transaction
    suspend fun upsertRoute(e: RouteEntity) {
        if (updateRoute(e) == 0) insertRoute(e)
    }

    @Query("DELETE FROM routes WHERE shift_client_id = :id")
    suspend fun deleteRoute(id: String)

    @Query("SELECT * FROM interruptions WHERE shift_client_id = :id ORDER BY from_ms, id")
    suspend fun interruptions(id: String): List<InterruptionEntity>

    @Insert
    suspend fun insertInterruptions(list: List<InterruptionEntity>)

    @Insert
    suspend fun insertInterruption(i: InterruptionEntity)

    @Query("DELETE FROM interruptions WHERE shift_client_id = :id")
    suspend fun deleteInterruptions(id: String)

    // Odometer, vehicles, overwrite log --------------------------------------------------------

    @Query("SELECT * FROM odometer_readings WHERE shift_client_id = :id ORDER BY kind DESC")
    suspend fun odometer(id: String): List<OdometerEntity>

    @Query("SELECT * FROM odometer_readings WHERE server_id = :serverId LIMIT 1")
    suspend fun odometerByServerId(serverId: Long): OdometerEntity?

    @Query(
        "SELECT o.* FROM odometer_readings o JOIN shifts s ON s.client_id = o.shift_client_id WHERE o.server_id = :serverId AND s.instance_id IS :instance LIMIT 1",
    )
    suspend fun odometerByServerIdOn(serverId: Long, instance: String?): OdometerEntity?

    @Insert
    suspend fun insertOdometer(e: OdometerEntity)

    @Update
    suspend fun updateOdometer(e: OdometerEntity): Int

    /** Update, else insert. (Room's @Upsert tells a conflict by the exception's message, which the JVM tests' SQLite stub drops.) */
    @Transaction
    suspend fun upsertOdometer(e: OdometerEntity) {
        if (updateOdometer(e) == 0) insertOdometer(e)
    }

    @Query("DELETE FROM odometer_readings WHERE shift_client_id = :id AND kind = :kind")
    suspend fun deleteOdometer(id: String, kind: String)

    @Query(
        "SELECT MAX(o.recorded_at) FROM odometer_readings o JOIN shifts s ON s.client_id = o.shift_client_id WHERE s.vehicle_id = :vehicleId",
    )
    suspend fun lastOdometerAt(vehicleId: Long): Long?

    @Query("SELECT * FROM vehicles ORDER BY archived_at IS NOT NULL, name")
    suspend fun vehicles(): List<VehicleEntity>

    @Insert
    suspend fun insertVehicle(e: VehicleEntity)

    @Update
    suspend fun updateVehicle(e: VehicleEntity): Int

    /** Update, else insert. (Room's @Upsert tells a conflict by the exception's message, which the JVM tests' SQLite stub drops.) */
    @Transaction
    suspend fun upsertVehicle(e: VehicleEntity) {
        if (updateVehicle(e) == 0) insertVehicle(e)
    }

    @Query("DELETE FROM vehicles WHERE id = :id")
    suspend fun deleteVehicle(id: Long)

    @Insert
    suspend fun insertOverwrite(e: OverwriteEntity)

    @Query("SELECT * FROM overwrite_log WHERE seen = 0 AND (entity_key = :id OR entity_key LIKE :prefix) ORDER BY id DESC")
    suspend fun overwrites(id: String, prefix: String): List<OverwriteEntity>

    @Query("UPDATE overwrite_log SET seen = 1 WHERE id = :id")
    suspend fun markOverwriteSeen(id: Long)

    // Fixes -----------------------------------------------------------------------------------

    @Insert
    suspend fun insertFixes(f: List<FixEntity>): List<Long>

    @Query("SELECT * FROM fixes WHERE shift_client_id = :id AND send_state <> 2 ORDER BY seq")
    suspend fun fixesFor(id: String): List<FixEntity>

    @Query("SELECT MAX(seq) FROM fixes WHERE shift_client_id = :id")
    suspend fun lastSeq(id: String): Long?

    @Query("SELECT shift_client_id FROM fixes WHERE send_state = 0 GROUP BY shift_client_id ORDER BY MIN(seq)")
    suspend fun shiftsWithPending(): List<String>

    @Query("SELECT * FROM fixes WHERE send_state = 0 AND shift_client_id = :id ORDER BY seq LIMIT :limit")
    suspend fun pending(id: String, limit: Int): List<FixEntity>

    @Query("SELECT COUNT(*) FROM fixes WHERE send_state = 0 AND shift_client_id = :id")
    suspend fun pendingCount(id: String): Long

    @Query("SELECT COUNT(*) FROM fixes WHERE send_state = 0")
    suspend fun pendingCountAll(): Long

    @Query("SELECT MIN(recorded_at) FROM fixes WHERE send_state = 0")
    suspend fun oldestPendingAt(): Long?

    @Query("SELECT COUNT(*) FROM fixes WHERE send_state = 2")
    suspend fun setAsideCount(): Long

    @Query("UPDATE fixes SET send_state = 1, sent_at = :at WHERE send_state = 0 AND seq IN (:seqs)")
    suspend fun markSent(seqs: List<Long>, at: Long): Int

    @Query("UPDATE fixes SET send_state = 2, sent_at = :at, set_aside_reason = :reason WHERE send_state = 0 AND seq IN (:seqs)")
    suspend fun setAside(seqs: List<Long>, reason: String, at: Long): Int

    @Query("SELECT * FROM fixes WHERE shift_client_id = :id AND seq > :after AND send_state <> 2 ORDER BY seq LIMIT :limit")
    suspend fun after(id: String, after: Long, limit: Int): List<FixEntity>

    @Query("SELECT MIN(seq) AS first_seq, MAX(seq) AS last_seq, COUNT(*) AS n FROM fixes WHERE shift_client_id = :id AND send_state <> 2")
    suspend fun manifest(id: String): ManifestRow

    /** The retention rule (`Retention` in :core): see there. */
    @Query(
        """DELETE FROM fixes WHERE send_state = 1 AND sent_at < :before
           AND shift_client_id IN (SELECT client_id FROM shifts WHERE sync_state = 'on_server' AND status <> 'active')
           AND shift_client_id NOT IN (SELECT shift_client_id FROM outbox)
           AND shift_client_id NOT IN (SELECT shift_client_id FROM resend_marks)""",
    )
    suspend fun evictSent(before: Long): Int

    @Query("DELETE FROM fixes WHERE shift_client_id = :id")
    suspend fun deleteFixes(id: String)

    // Outbox ----------------------------------------------------------------------------------

    @Insert
    suspend fun insertChange(o: OutboxEntity): Long

    @Query("UPDATE outbox SET body = :body, attempts = 0, last_error = NULL WHERE id = :id")
    suspend fun replaceChange(id: Long, body: String)

    @Query("SELECT id FROM outbox WHERE status = 'pending' AND kind = :kind AND entity_key = :key ORDER BY id DESC")
    suspend fun pendingIds(kind: String, key: String): List<Long>

    @Query("SELECT * FROM outbox WHERE status = :status ORDER BY id")
    suspend fun changes(status: String): List<OutboxEntity>

    @Query("SELECT SUM(status = 'pending') AS p, SUM(status = 'parked') AS k, MIN(created_at) AS o FROM outbox")
    suspend fun changeCounts(): OutboxCountRow

    @Query("SELECT EXISTS(SELECT 1 FROM outbox WHERE kind = :kind AND shift_client_id = :id)")
    suspend fun hasChange(kind: String, id: String): Boolean

    @Query("SELECT EXISTS(SELECT 1 FROM outbox WHERE shift_client_id = :id)")
    suspend fun hasAnyChange(id: String): Boolean

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun deleteChange(id: Long)

    @Query("DELETE FROM outbox WHERE id = :id AND body = :body")
    suspend fun deleteSentChange(id: Long, body: String)

    @Query("UPDATE outbox SET attempts = attempts + 1, last_error = :error WHERE id = :id")
    suspend fun changeFailed(id: Long, error: String)

    @Query("UPDATE outbox SET status = 'parked', attempts = attempts + 1, last_error = :error WHERE id = :id")
    suspend fun parkChange(id: Long, error: String)

    @Query("UPDATE outbox SET status = 'pending', last_error = NULL WHERE status = 'parked'")
    suspend fun unparkAll(): Int

    @Query("UPDATE outbox SET status = 'pending', last_error = NULL WHERE status = 'parked' AND shift_client_id = :id")
    suspend fun unpark(id: String): Int

    @Query("DELETE FROM outbox WHERE shift_client_id = :id")
    suspend fun dropChanges(id: String)

    // Resend marks, bookkeeping, diagnostics ---------------------------------------------------

    @Query("SELECT * FROM resend_marks")
    suspend fun resendMarks(): List<ResendEntity>

    @Query("SELECT * FROM resend_marks WHERE shift_client_id = :id")
    suspend fun resendMark(id: String): ResendEntity?

    @Query("INSERT INTO resend_marks (shift_client_id, gen, phase, after_seq) VALUES (:id, :gen, :phase, :after) ON CONFLICT(shift_client_id) DO UPDATE SET gen = excluded.gen, phase = excluded.phase, after_seq = excluded.after_seq")
    suspend fun upsertResend(id: String, gen: Long, phase: String, after: Long)

    @Query(
        """UPDATE resend_marks SET gen = :gen, phase = :phase, after_seq = :after
           WHERE shift_client_id = :id AND gen = :oldGen AND phase = :oldPhase AND after_seq = :oldAfter""",
    )
    suspend fun swapResend(id: String, oldGen: Long, oldPhase: String, oldAfter: Long, gen: Long, phase: String, after: Long): Int

    @Query("DELETE FROM resend_marks WHERE shift_client_id = :id AND gen = :gen AND phase = :phase AND after_seq = :after")
    suspend fun dropResend(id: String, gen: Long, phase: String, after: Long): Int

    @Query("DELETE FROM resend_marks WHERE shift_client_id = :id")
    suspend fun deleteResend(id: String)

    @Query("SELECT value FROM bookkeeping WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Query("INSERT INTO bookkeeping (`key`, value) VALUES (:key, :value) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value")
    suspend fun put(key: String, value: String)

    @Query("DELETE FROM bookkeeping WHERE `key` = :key")
    suspend fun remove(key: String)

    @Insert
    suspend fun insertDiag(e: DiagEventEntity)

    @Query("SELECT * FROM diag_events ORDER BY id LIMIT :limit")
    suspend fun oldestDiag(limit: Int): List<DiagEventEntity>

    @Query("DELETE FROM diag_events WHERE id IN (:ids)")
    suspend fun deleteDiag(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM diag_events")
    suspend fun diagCount(): Int

    @Query("DELETE FROM diag_events")
    suspend fun clearDiag()
}
