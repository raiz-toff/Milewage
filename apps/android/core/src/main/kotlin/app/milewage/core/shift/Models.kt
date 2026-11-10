package app.milewage.core.shift

import app.milewage.core.api.PointManifest
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.engine.Flag

/*
 * What the phone keeps about its shifts (15 section 2.2), in the GLOSSARY's terms. The store
 * (`LocalStore`, Room in :data) reads and writes these; everything that decides anything about them
 * is in this package and in app.milewage.core.sync, so it runs on the JVM and later on iOS.
 */

/** A shift's lifecycle. [RUNNING] is the server's `active`. */
enum class ShiftStatus(val wire: String) {
    RUNNING("active"),
    ENDED("ended"),
    FINALIZED("finalized"),
    ;

    companion object {
        fun of(wire: String): ShiftStatus = entries.firstOrNull { it.wire == wire } ?: ENDED
    }
}

/**
 * Where a shift stands with the server (15 section 4.1). [ON_PHONE_ONLY]: the server does not have
 * it (or not all of it) yet; [SENT]: the server accepted it, end included ("Sent to the server");
 * [NEEDS_ATTENTION]: the server refused a change for good and the driver should look.
 */
enum class SendState(val wire: String) {
    ON_PHONE_ONLY("local"),
    SENDING("syncing"),
    SENT("on_server"),
    NEEDS_ATTENTION("needs_attention"),
    ;

    companion object {
        fun of(wire: String): SendState = entries.firstOrNull { it.wire == wire } ?: ON_PHONE_ONLY
    }
}

/** Whose numbers a shift shows: the phone result until the server's answer replaces it. */
enum class CalcSource(val wire: String) {
    PHONE("phone"),
    SERVER("server"),
    ;

    companion object {
        fun of(wire: String): CalcSource = if (wire == "server") SERVER else PHONE
    }
}

/** How the server's total compares with the phone result (the Difference, 14 section 9.3). */
enum class ReconStatus(val wire: String) {
    PENDING("pending"),
    MATCH("match"),
    DIFFERS("differs"),
    PHONE_MISSING("phone_missing"),
    ;

    companion object {
        fun of(wire: String?): ReconStatus = entries.firstOrNull { it.wire == wire } ?: PENDING
    }
}

/** Metres per bucket. Business distance is [totalM] minus [personalM] (ADR 0005). */
data class Distances(val totalM: Long, val activeM: Long, val deadheadM: Long, val personalM: Long) {
    val businessM: Long get() = maxOf(0, totalM - personalM)
}

/** A battery reading at shift start or end (16 section 3.2, `shift.summary`). */
data class BatteryReading(val level: Int, val charging: Boolean)

/** A flag the server put on a shift (`ShiftFlag`); shown, not branched on. */
data class ServerFlag(val code: String, val severity: String)

/**
 * One shift as the phone keeps it. [distances] is null until a result exists (the phone's or the
 * server's). [phoneFlags] are the engine's flags from the phone run; [serverFlags] those of the
 * server's last answer or change.
 */
data class ShiftRecord(
    val clientId: String,
    val serverId: Long? = null,
    val vehicleId: Long,
    val status: ShiftStatus,
    val segmenter: Segmenter,
    val startedAt: Long,
    val endedAt: Long? = null,
    /** YYYY-MM-DD in the instance's zone (15 section 10), never the phone's. */
    val localDate: String,
    val distances: Distances? = null,
    val calcVersion: Int? = null,
    val inputDigest: String? = null,
    val phoneFlags: List<Flag> = emptyList(),
    val serverFlags: List<ServerFlag> = emptyList(),
    val calcSource: CalcSource = CalcSource.PHONE,
    val serverTotalM: Long? = null,
    val recon: ReconStatus = ReconStatus.PENDING,
    val reconReasons: List<String> = emptyList(),
    /** Which fixes the phone result was computed from (sent with `end`). */
    val manifest: PointManifest? = null,
    /** The engine ended it at its last fix (14 section 7.4), not the driver. */
    val autoClosed: Boolean = false,
    /** Median phone clock minus GNSS time over the shift's GNSS fixes. */
    val clockSkewMs: Long? = null,
    val notes: String? = null,
    val updatedAt: Long,
    val sendState: SendState = SendState.ON_PHONE_ONLY,
    /** The server's deduction value (cents) from the change log; meaningful when [serverDeductionKnown]. */
    val serverDeductionCents: Long? = null,
    val serverDeductionKnown: Boolean = false,
    /**
     * The server refused this running shift's create with 409 `shift_already_active`: another shift
     * runs there (started on the web or another phone). The shift keeps recording and its create
     * is tried again every round; the screen says so until the other shift ends.
     */
    val serverHasOtherShift: Boolean = false,
    val batteryStart: BatteryReading? = null,
    val batteryEnd: BatteryReading? = null,
    /** How long the phone's engine run took, ms (for `shift.summary`). */
    val engineMs: Long? = null,
) {
    val running: Boolean get() = status == ShiftStatus.RUNNING
}

enum class TripSource(val wire: String) {
    AUTO("auto"),
    MANUAL("manual"),
    ;

    companion object {
        fun of(wire: String): TripSource = if (wire == "manual") MANUAL else AUTO
    }
}

/**
 * A trip as shown: an automatic trip from a result with the driver's trip edit applied
 * ([editedAt] not null), or a manual trip. The distance of an automatic trip is never edited.
 */
data class TripRecord(
    val tripKey: String,
    val shiftClientId: String,
    val serverId: Long? = null,
    val kind: TripKind,
    val originalKind: TripKind,
    val source: TripSource,
    val startedAt: Long,
    val endedAt: Long,
    val startLatE7: Long? = null,
    val startLonE7: Long? = null,
    val endLatE7: Long? = null,
    val endLonE7: Long? = null,
    val distanceM: Long,
    val purpose: String,
    val editedAt: Long? = null,
    val sendState: SendState = SendState.ON_PHONE_ONLY,
)

data class StopRecord(
    val stopKey: String,
    val shiftClientId: String,
    val startedAt: Long,
    val endedAt: Long,
    val dwellS: Long,
    val latE7: Long,
    val lonE7: Long,
    /** low, medium, high. */
    val confidence: String,
    /** pickup, dropoff, none. */
    val estRole: String,
    /** pickup, dropoff, other, none. */
    val role: String,
)

/** One point of the simplified route (for the map), degrees x 1e7 and its time. */
data class RoutePoint(val latE7: Long, val lonE7: Long, val t: Long)

enum class OdometerKind(val wire: String) {
    SHIFT_START("shift_start"),
    SHIFT_END("shift_end"),
    ;

    companion object {
        fun of(wire: String): OdometerKind? = entries.firstOrNull { it.wire == wire }
    }
}

fun OdometerKind.toApi(): app.milewage.core.api.ShiftOdometer =
    if (this == OdometerKind.SHIFT_START) app.milewage.core.api.ShiftOdometer.SHIFT_START else app.milewage.core.api.ShiftOdometer.SHIFT_END

data class OdometerRecord(
    val shiftClientId: String,
    val kind: OdometerKind,
    /** Whole metres. */
    val readingM: Long,
    val recordedAt: Long,
    val serverId: Long? = null,
    val sendState: SendState = SendState.ON_PHONE_ONLY,
)

/** A vehicle from the server (`GET /vehicles` or the change log), kept to start shifts offline. */
data class VehicleRecord(
    val id: Long,
    val name: String,
    /** car, motorcycle, scooter, bicycle, ... (shown and passed to the rates). */
    val kind: String,
    val plate: String? = null,
    val archivedAt: Long? = null,
)

/** Why the phone's own value was replaced (15 section 8.2): the phone's side of the overwrite log. */
enum class OverwriteReason(val wire: String) {
    SUPERSEDED_BY_SERVER("superseded_by_server"),
    DELETED_ON_SERVER("deleted_on_server"),
    /** The server's recalculation gave another total: the Difference. */
    RECON_DIFF("recon_diff"),
    POINTS_MISSING("points_missing"),
    CALC_VERSION("calc_version"),
    ;

    companion object {
        fun of(wire: String): OverwriteReason = entries.firstOrNull { it.wire == wire } ?: SUPERSEDED_BY_SERVER
    }
}

/** One entry of the phone's overwrite log: what it had, what the server holds, and why. */
data class OverwriteEntry(
    val id: Long = 0,
    val at: Long,
    /** shift, trip or odometer. */
    val entity: String,
    val entityKey: String,
    val reason: OverwriteReason,
    /** JSON of the phone's value. */
    val localJson: String,
    /** JSON of the server's value; null for a delete. */
    val serverJson: String?,
    val seen: Boolean = false,
)
