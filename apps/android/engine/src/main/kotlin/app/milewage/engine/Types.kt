// Port of packages/track-engine/src/types.ts.
// All numbers are integers. Times are UTC epoch milliseconds (Long). Coordinates are degrees x 1e7
// (Int: the server accepts |latE7| <= 900000000 and |lonE7| <= 1800000000). Distances and times
// that are summed or multiplied are Long. Field names are the TypeScript names, so the JSON the
// phone sends and the fixtures the tests read map one to one.
package app.milewage.engine

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A string union of the TypeScript types. [wire] is the TypeScript string; order and digests use it, never the ordinal. */
interface WireEnum {
    val wire: String
}

@Serializable
data class Fix(
    /** Device-assigned, strictly increasing, never reused. */
    val seq: Long,
    /** The fix's own GNSS time. */
    val recordedAt: Long,
    val latE7: Int,
    val lonE7: Int,
    /** Horizontal accuracy radius, whole metres. */
    val accuracyM: Int,
    /** Reported speed, decimetres per second. */
    val speedDmps: Int? = null,
    val bearingDeg: Int? = null,
    val altitudeM: Int? = null,
)

@Serializable
enum class LabelRole(override val wire: String) : WireEnum {
    @SerialName("pickup") PICKUP("pickup"),
    @SerialName("dropoff") DROPOFF("dropoff"),
    @SerialName("other") OTHER("other"),
}

@Serializable
data class StopLabelInput(val stopKey: String, val role: LabelRole)

@Serializable
enum class Confidence(override val wire: String) : WireEnum {
    @SerialName("low") LOW("low"),
    @SerialName("medium") MEDIUM("medium"),
    @SerialName("high") HIGH("high"),
}

@Serializable
enum class EstRole(override val wire: String) : WireEnum {
    @SerialName("pickup") PICKUP("pickup"),
    @SerialName("dropoff") DROPOFF("dropoff"),
    @SerialName("none") NONE("none"),
}

@Serializable
enum class StopRole(override val wire: String) : WireEnum {
    @SerialName("pickup") PICKUP("pickup"),
    @SerialName("dropoff") DROPOFF("dropoff"),
    @SerialName("other") OTHER("other"),
    @SerialName("none") NONE("none"),
}

@Serializable
data class Stop(
    /** `${shiftClientId}:${startedAt}:stop` */
    val stopKey: String,
    val startedAt: Long,
    val endedAt: Long,
    val dwellS: Long,
    val latE7: Int,
    val lonE7: Int,
    val confidence: Confidence,
    val estRole: EstRole,
    val role: StopRole,
)

/** `TripState` of stops.ts: the estimate's state, and a trip's original kind. */
@Serializable
enum class TripState(override val wire: String) : WireEnum {
    @SerialName("active") ACTIVE("active"),
    @SerialName("deadhead") DEADHEAD("deadhead"),
    ;

    val asKind: TripKind get() = if (this == ACTIVE) TripKind.ACTIVE else TripKind.DEADHEAD
}

@Serializable
enum class TripKind(override val wire: String) : WireEnum {
    @SerialName("active") ACTIVE("active"),
    @SerialName("deadhead") DEADHEAD("deadhead"),
    @SerialName("personal") PERSONAL("personal"),
}

/** 07 section 2.3 trip row, as far as the engine produces it. */
@Serializable
data class Trip(
    /** `<shiftClientId>:<segment start ms>:<original kind>` */
    val tripKey: String,
    val kind: TripKind,
    val originalKind: TripState,
    val startedAt: Long,
    val endedAt: Long,
    val startLatE7: Int,
    val startLonE7: Int,
    val endLatE7: Int,
    val endLonE7: Int,
    val distanceM: Long,
    val purpose: String,
)

/** A driver reclassification (07 section 3 rule 7), keyed by tripKey (14 section 6.7). */
@Serializable
data class TripEdit(
    val tripKey: String,
    val kind: TripKind? = null,
    val purpose: String? = null,
)

@Serializable
enum class FlagCode(override val wire: String) : WireEnum {
    @SerialName("gap_counted") GAP_COUNTED("gap_counted"),
    @SerialName("gap_large") GAP_LARGE("gap_large"),
    @SerialName("gap_dropped") GAP_DROPPED("gap_dropped"),
    @SerialName("tracking_interrupted") TRACKING_INTERRUPTED("tracking_interrupted"),
    @SerialName("shift_auto_closed") SHIFT_AUTO_CLOSED("shift_auto_closed"),
    @SerialName("no_stops_detected") NO_STOPS_DETECTED("no_stops_detected"),
    @SerialName("long_stop") LONG_STOP("long_stop"),
    @SerialName("label_orphaned") LABEL_ORPHANED("label_orphaned"),
    @SerialName("poor_accuracy_share") POOR_ACCURACY_SHARE("poor_accuracy_share"),
    @SerialName("low_fix_density") LOW_FIX_DENSITY("low_fix_density"),
    @SerialName("clock_skew") CLOCK_SKEW("clock_skew"),
    @SerialName("override_orphaned") OVERRIDE_ORPHANED("override_orphaned"),
    @SerialName("manual_trip_present") MANUAL_TRIP_PRESENT("manual_trip_present"),
    @SerialName("calc_mismatch") CALC_MISMATCH("calc_mismatch"),
}

@Serializable
data class Flag(
    val code: FlagCode,
    /** Epoch ms the flag refers to, when it has one. */
    val at: Long? = null,
    val detail: String? = null,
)

@Serializable
enum class Segmenter(override val wire: String) : WireEnum {
    @SerialName("stops") STOPS("stops"),
    @SerialName("whole_shift") WHOLE_SHIFT("whole_shift"),
}

@Serializable
data class Interruption(val fromMs: Long, val toMs: Long)

/**
 * The engine's input. The TypeScript optional lists are empty lists here: every stage treats
 * `undefined` and `[]` the same, so the output and the digest are equal either way.
 */
@Serializable
data class ShiftInput(
    val shiftClientId: String,
    val startedAt: Long,
    val endedAt: Long,
    /** Any order, duplicates allowed. */
    val fixes: List<Fix>,
    val segmenter: Segmenter,
    val stopLabels: List<StopLabelInput> = emptyList(),
    val interruptions: List<Interruption> = emptyList(),
    val edits: List<TripEdit> = emptyList(),
    /** True when the app ended an unfinished shift at its last fix (14 section 7.4). */
    val autoClosed: Boolean = false,
    /** Median phone-clock minus GNSS time in ms, measured by the app on live fixes (14 section 15). */
    val clockSkewMs: Long? = null,
)

@Serializable
data class Totals(val totalM: Long, val activeM: Long, val deadheadM: Long, val personalM: Long)

@Serializable
data class ShiftResult(
    val algorithmVersion: Int,
    val inputDigest: String,
    val totals: Totals,
    val trips: List<Trip>,
    val stops: List<Stop>,
    val route: List<RoutePoint>,
    val flags: List<Flag>,
    /** Insertion order as in process.ts; the canonical form sorts the keys. */
    val stats: Map<String, Long>,
)
