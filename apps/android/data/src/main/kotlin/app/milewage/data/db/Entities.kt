package app.milewage.data.db

import androidx.room3.ColumnInfo
import androidx.room3.Entity
import androidx.room3.ForeignKey
import androidx.room3.Index
import androidx.room3.PrimaryKey

/*
 * The phone's tables (15 section 2.2, redesigned for Room from the Expo app's `db/schema.ts`). Enum
 * values are stored as their wire strings (the server's words), so a row reads the same in a SQL
 * shell as in the API. Times are UTC epoch milliseconds, distances whole metres, positions degrees
 * x 1e7. Children of a shift (trips, stops, route, odometer readings) cascade from it; fixes,
 * interruptions and the outbox do not: a fix is never lost to a missing or deleted parent row, and
 * those are deleted explicitly with their shift.
 */

/** One shift (the running one too). Totals are null until a result exists. */
@Entity(
    tableName = "shifts",
    indices = [
        Index(value = ["server_id"], unique = true),
        Index(value = ["started_at"]),
        Index(value = ["status"]),
        Index(value = ["sync_state"]),
        Index(value = ["local_date"]),
        Index(value = ["vehicle_id"]),
    ],
)
data class ShiftEntity(
    @PrimaryKey @ColumnInfo(name = "client_id") val clientId: String,
    @ColumnInfo(name = "server_id") val serverId: Long?,
    @ColumnInfo(name = "vehicle_id") val vehicleId: Long,
    /** active, ended, finalized. */
    val status: String,
    /** stops, whole_shift. */
    val segmenter: String,
    @ColumnInfo(name = "started_at") val startedAt: Long,
    @ColumnInfo(name = "ended_at") val endedAt: Long?,
    /** YYYY-MM-DD in the instance zone. */
    @ColumnInfo(name = "local_date") val localDate: String,
    @ColumnInfo(name = "total_m") val totalM: Long?,
    @ColumnInfo(name = "active_m") val activeM: Long?,
    @ColumnInfo(name = "deadhead_m") val deadheadM: Long?,
    @ColumnInfo(name = "personal_m") val personalM: Long?,
    @ColumnInfo(name = "calc_version") val calcVersion: Int?,
    @ColumnInfo(name = "input_digest") val inputDigest: String?,
    /** The phone run's engine flags, JSON (code, at, detail). */
    @ColumnInfo(name = "flags_json") val flagsJson: String?,
    /** The server's flags, JSON (code, severity). */
    @ColumnInfo(name = "server_flags_json") val serverFlagsJson: String?,
    /** phone, server. */
    @ColumnInfo(name = "calc_source") val calcSource: String,
    @ColumnInfo(name = "server_total_m") val serverTotalM: Long?,
    /** pending, match, differs, phone_missing. */
    @ColumnInfo(name = "recon_status") val reconStatus: String,
    @ColumnInfo(name = "recon_reasons_json") val reconReasonsJson: String,
    @ColumnInfo(name = "first_seq") val firstSeq: Long?,
    @ColumnInfo(name = "last_seq") val lastSeq: Long?,
    @ColumnInfo(name = "point_count") val pointCount: Long?,
    @ColumnInfo(name = "auto_closed") val autoClosed: Boolean,
    @ColumnInfo(name = "clock_skew_ms") val clockSkewMs: Long?,
    val notes: String?,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    /** local, syncing, on_server, needs_attention. */
    @ColumnInfo(name = "sync_state") val syncState: String,
    @ColumnInfo(name = "server_deduction_cents") val serverDeductionCents: Long?,
    @ColumnInfo(name = "server_deduction_known") val serverDeductionKnown: Boolean,
    @ColumnInfo(name = "server_has_other_shift") val serverHasOtherShift: Boolean,
    @ColumnInfo(name = "battery_start_pct") val batteryStartPct: Int?,
    @ColumnInfo(name = "battery_start_charging") val batteryStartCharging: Boolean?,
    @ColumnInfo(name = "battery_end_pct") val batteryEndPct: Int?,
    @ColumnInfo(name = "battery_end_charging") val batteryEndCharging: Boolean?,
    @ColumnInfo(name = "engine_ms") val engineMs: Long?,
)

/**
 * One fix: the record of a shift (the wire fields of 08 section 5 plus three local-only ones).
 * `seq` is AUTOINCREMENT: strictly increasing and never reused, also across shifts and deletes.
 * `send_state` 0 pending, 1 sent (acknowledged at `sent_at`), 2 set aside (refused for good, kept).
 */
@Entity(
    tableName = "fixes",
    indices = [
        Index(value = ["shift_client_id", "seq"]),
        Index(value = ["send_state", "shift_client_id", "seq"]),
        Index(value = ["send_state", "sent_at"]),
    ],
)
data class FixEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    @ColumnInfo(name = "recorded_at") val recordedAt: Long,
    @ColumnInfo(name = "lat_e7") val latE7: Long,
    @ColumnInfo(name = "lon_e7") val lonE7: Long,
    @ColumnInfo(name = "accuracy_m") val accuracyM: Long,
    @ColumnInfo(name = "speed_dmps") val speedDmps: Long?,
    @ColumnInfo(name = "bearing_deg") val bearingDeg: Long?,
    @ColumnInfo(name = "altitude_m") val altitudeM: Long?,
    /** Local only: gps, network, fused, passive. */
    val provider: String?,
    /** Local only: the monotonic clock at the fix. */
    @ColumnInfo(name = "elapsed_realtime_ms") val elapsedRealtimeMs: Long?,
    /** Local only: the phone's wall clock at the fix (clock skew). */
    @ColumnInfo(name = "phone_time_ms") val phoneTimeMs: Long?,
    @ColumnInfo(name = "send_state", defaultValue = "0") val sendState: Int = PENDING,
    @ColumnInfo(name = "sent_at") val sentAt: Long? = null,
    @ColumnInfo(name = "set_aside_reason") val setAsideReason: String? = null,
) {
    companion object {
        const val PENDING = 0
        const val SENT = 1
        const val SET_ASIDE = 2
    }
}

/** A span with no recording the tracker knew about, kept with its shift at the end. */
@Entity(tableName = "interruptions", indices = [Index(value = ["shift_client_id"])])
data class InterruptionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    @ColumnInfo(name = "from_ms") val fromMs: Long,
    @ColumnInfo(name = "to_ms") val toMs: Long,
    /** SERVICE_RESTARTED, LOCATION_OFF, PERMISSION_LOST. */
    val reason: String,
)

private const val SHIFT_FK = "client_id"

@Entity(
    tableName = "trips",
    foreignKeys = [ForeignKey(ShiftEntity::class, [SHIFT_FK], ["shift_client_id"], onDelete = ForeignKey.CASCADE)],
    indices = [Index(value = ["shift_client_id", "started_at"]), Index(value = ["server_id"])],
)
data class TripEntity(
    @PrimaryKey @ColumnInfo(name = "trip_key") val tripKey: String,
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    @ColumnInfo(name = "server_id") val serverId: Long?,
    /** active, deadhead, personal. */
    val kind: String,
    @ColumnInfo(name = "original_kind") val originalKind: String,
    /** auto, manual. */
    val source: String,
    @ColumnInfo(name = "started_at") val startedAt: Long,
    @ColumnInfo(name = "ended_at") val endedAt: Long,
    @ColumnInfo(name = "start_lat_e7") val startLatE7: Long?,
    @ColumnInfo(name = "start_lon_e7") val startLonE7: Long?,
    @ColumnInfo(name = "end_lat_e7") val endLatE7: Long?,
    @ColumnInfo(name = "end_lon_e7") val endLonE7: Long?,
    @ColumnInfo(name = "distance_m") val distanceM: Long,
    val purpose: String,
    /** Set by a trip edit (or for a manual trip, its last change). */
    @ColumnInfo(name = "edited_at") val editedAt: Long?,
    @ColumnInfo(name = "sync_state") val syncState: String,
)

@Entity(
    tableName = "stops",
    foreignKeys = [ForeignKey(ShiftEntity::class, [SHIFT_FK], ["shift_client_id"], onDelete = ForeignKey.CASCADE)],
    indices = [Index(value = ["shift_client_id", "started_at"])],
)
data class StopEntity(
    @PrimaryKey @ColumnInfo(name = "stop_key") val stopKey: String,
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    @ColumnInfo(name = "started_at") val startedAt: Long,
    @ColumnInfo(name = "ended_at") val endedAt: Long,
    @ColumnInfo(name = "dwell_s") val dwellS: Long,
    @ColumnInfo(name = "lat_e7") val latE7: Long,
    @ColumnInfo(name = "lon_e7") val lonE7: Long,
    val confidence: String,
    @ColumnInfo(name = "est_role") val estRole: String,
    val role: String,
)

/** The simplified route for the map, one row per shift (kept out of the shifts row so lists stay light). */
@Entity(
    tableName = "routes",
    foreignKeys = [ForeignKey(ShiftEntity::class, [SHIFT_FK], ["shift_client_id"], onDelete = ForeignKey.CASCADE)],
)
data class RouteEntity(
    @PrimaryKey @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    /** JSON [[latE7, lonE7, t], ...]. */
    @ColumnInfo(name = "points_json") val pointsJson: String,
)

@Entity(
    tableName = "odometer_readings",
    primaryKeys = ["shift_client_id", "kind"],
    foreignKeys = [ForeignKey(ShiftEntity::class, [SHIFT_FK], ["shift_client_id"], onDelete = ForeignKey.CASCADE)],
    indices = [Index(value = ["server_id"])],
)
data class OdometerEntity(
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    /** shift_start, shift_end. */
    val kind: String,
    @ColumnInfo(name = "reading_m") val readingM: Long,
    @ColumnInfo(name = "recorded_at") val recordedAt: Long,
    @ColumnInfo(name = "server_id") val serverId: Long?,
    @ColumnInfo(name = "sync_state") val syncState: String,
)

@Entity(tableName = "vehicles")
data class VehicleEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val kind: String,
    val plate: String?,
    @ColumnInfo(name = "archived_at") val archivedAt: Long?,
)

/** The durable queue of changes for the server (08 section 4.1). */
@Entity(
    tableName = "outbox",
    indices = [
        Index(value = ["status", "id"]),
        Index(value = ["shift_client_id", "kind"]),
        Index(value = ["kind", "entity_key"]),
    ],
)
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** shift.create, shift.patch, odometer.put, trip.override, trip.manual, shift.end. */
    val kind: String,
    @ColumnInfo(name = "entity_key") val entityKey: String,
    /** The entity key's shift, for the per-shift queries. */
    @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    /** The exact request body (JSON). */
    val body: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    val attempts: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    /** pending, parked. An answered row is deleted. */
    val status: String = "pending",
)

/** The phone's side of the overwrite log: what it had when the server's value replaced it (15 section 8.2). */
@Entity(tableName = "overwrite_log", indices = [Index(value = ["entity_key"]), Index(value = ["seen"])])
data class OverwriteEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: Long,
    val entity: String,
    @ColumnInfo(name = "entity_key") val entityKey: String,
    val reason: String,
    @ColumnInfo(name = "local_json") val localJson: String,
    @ColumnInfo(name = "server_json") val serverJson: String?,
    val seen: Boolean = false,
)

/** One per shift to send again after a server restore (15 section 9.3). */
@Entity(tableName = "resend_marks")
data class ResendEntity(
    @PrimaryKey @ColumnInfo(name = "shift_client_id") val shiftClientId: String,
    val gen: Long,
    /** todo, queued. */
    val phase: String,
    @ColumnInfo(name = "after_seq") val afterSeq: Long,
)

/** Small values: the change-log cursor, the restore generation, last times, reminder and diagnostics state. */
@Entity(tableName = "bookkeeping")
data class BookkeepingEntity(
    @PrimaryKey val key: String,
    val value: String,
)

/** The diagnostics ring (16 section 6.1): validated events waiting to be sent. */
@Entity(tableName = "diag_events", indices = [Index(value = ["kind"])])
data class DiagEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,
    val level: String,
    /** The whole event as the server takes it (JSON). */
    val json: String,
)
