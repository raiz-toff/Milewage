package app.milewage.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

/*
 * The slice of the MileWage API the phone uses, with the wire names of
 * packages/shared/openapi/openapi.yaml (the contract). Written by hand and checked against the spec by
 * ContractDriftTest (see data/README.md, "The contract"): a renamed, removed or retyped field, a new
 * required request field, or a path that moved fails `./gradlew :core:test`.
 *
 * Rules:
 * - Integers are Long (ids, epoch milliseconds, metres, cents), so nothing overflows.
 * - Enums the phone sends or branches on are Kotlin enums. Enums the phone only shows or passes
 *   along (vehicle kind, work kinds, flag codes, change entities) are strings: a newer server may add
 *   values, and an unknown value must not make a whole answer unreadable.
 * - Response fields that older servers lack, or that the phone does not need, have defaults, so an
 *   answer from a 0.1 server still reads. Request bodies hold exactly the contract's fields.
 */

// ---------------------------------------------------------------------------------------------
// Shared enums

@Serializable
enum class DevicePlatform {
    @SerialName("android") ANDROID,
    @SerialName("ios") IOS,
}

@Serializable
enum class Segmenter {
    @SerialName("stops") STOPS,
    @SerialName("whole_shift") WHOLE_SHIFT,
}

@Serializable
enum class TripKind {
    @SerialName("active") ACTIVE,
    @SerialName("deadhead") DEADHEAD,
    @SerialName("personal") PERSONAL,
}

@Serializable
enum class DistanceUnit {
    @SerialName("km") KM,
    @SerialName("mi") MI,
}

@Serializable
enum class ShiftStatus {
    @SerialName("active") ACTIVE,
    @SerialName("ended") ENDED,
    @SerialName("finalized") FINALIZED,
}

/** The two odometer readings a shift has (`PUT /shifts/{ref}/odometer/{kind}`). */
@Serializable
enum class ShiftOdometer(val wire: String) {
    @SerialName("shift_start") SHIFT_START("shift_start"),
    @SerialName("shift_end") SHIFT_END("shift_end"),
}

@Serializable
enum class DiagnosticsLevel {
    @SerialName("off") OFF,
    @SerialName("basic") BASIC,
    @SerialName("verbose") VERBOSE,
}

@Serializable
enum class DiagEventLevel {
    @SerialName("basic") BASIC,
    @SerialName("verbose") VERBOSE,
}

@Serializable
enum class DiagSource {
    @SerialName("phone_native") PHONE_NATIVE,
    @SerialName("phone_js") PHONE_JS,
    @SerialName("server") SERVER,
    @SerialName("web") WEB,
}

@Serializable
enum class MileageRate {
    @SerialName("official") OFFICIAL,
    @SerialName("yours") YOURS,
    @SerialName("none") NONE,
}

// ---------------------------------------------------------------------------------------------
// System

/** `GET /healthz` (outside /api/v1). */
@Serializable
data class Health(val ok: Boolean)

/** RFC 9457 problem+json, as every refusal is written (components.schemas.Problem). */
@Serializable
data class Problem(
    val type: String = "about:blank",
    val title: String = "",
    val status: Int = 0,
    val code: String,
    val detail: String? = null,
    val retryable: Boolean = false,
    @SerialName("request_id") val requestId: String? = null,
    val errors: List<FieldError> = emptyList(),
)

@Serializable
data class FieldError(val path: String, val message: String)

// ---------------------------------------------------------------------------------------------
// Pairing and linking (devices module)

/** `POST /pairing/redeem`. */
@Serializable
data class RedeemRequest(
    val token: String,
    @SerialName("device_name") val deviceName: String,
    val platform: DevicePlatform,
    @SerialName("app_version") val appVersion: String? = null,
)

/**
 * The answer to `POST /pairing/redeem` (201) and `POST /link-requests/poll` (201): the device
 * credential, returned once. `home_url` and `away_url` (plan 28) are absent from older servers.
 */
@Serializable
data class Paired(
    @SerialName("device_id") val deviceId: Long,
    @SerialName("device_token") val deviceToken: String,
    val settings: Settings,
    @SerialName("home_url") val homeUrl: String? = null,
    @SerialName("away_url") val awayUrl: String? = null,
)

/** `POST /link-requests`: a phone that found the server on the Wi-Fi asks to link (RFC 8628 shape). */
@Serializable
data class LinkRequestCreate(
    @SerialName("device_name") val deviceName: String,
    val platform: DevicePlatform,
)

@Serializable
data class LinkStarted(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    /** Seconds. Checked by the caller (a strange value falls back to 600). */
    @SerialName("expires_in") val expiresIn: Long? = null,
    /** Seconds between polls (falls back to 5). */
    val interval: Long? = null,
)

/** `POST /link-requests/poll`. */
@Serializable
data class LinkPoll(@SerialName("device_code") val deviceCode: String)

/** 202 from `POST /link-requests/poll`: the driver has not typed the code yet. */
@Serializable
data class LinkPending(val status: String)

// ---------------------------------------------------------------------------------------------
// Settings

/** `GET /settings` (components.schemas.Settings). Fields newer than 0.1 default to "not set". */
@Serializable
data class Settings(
    val country: String,
    @SerialName("distance_unit") val distanceUnit: DistanceUnit,
    val currency: String,
    /** IANA zone of the instance; local dates never use the phone's zone. */
    val timezone: String,
    @SerialName("stops_enabled") val stopsEnabled: Boolean,
    @SerialName("engine_version") val engineVersion: Int,
    val diagnostics: DiagnosticsSettings,
    val modules: Modules,
    @SerialName("raw_retention_days") val rawRetentionDays: Int? = null,
    @SerialName("help_enabled") val helpEnabled: Boolean? = null,
    @SerialName("display_name") val displayName: String? = null,
    val region: String? = null,
    val logbook: Logbook? = null,
    @SerialName("own_mileage_rate") val ownMileageRate: OwnMileageRate? = null,
    @SerialName("mileage_rate") val mileageRate: MileageRate? = null,
    /** 0 Sunday, 1 Monday. */
    @SerialName("week_start") val weekStart: Int? = null,
    /** `12h` or `24h`. */
    @SerialName("time_format") val timeFormat: String? = null,
    @SerialName("default_vehicle_id") val defaultVehicleId: Long? = null,
    @SerialName("work_kinds") val workKinds: List<String> = emptyList(),
    @SerialName("onboarded_at") val onboardedAt: Long? = null,
    @SerialName("setup_done") val setupDone: List<String> = emptyList(),
)

/** The module flags the phone reads. Unknown (null) when the server did not say. */
@Serializable
data class Modules(
    val tracking: Boolean? = null,
    /** Effective: the stops module is registered and settings.stops_enabled is on. */
    val stops: Boolean? = null,
    val sync: Boolean? = null,
    val diagnostics: Boolean? = null,
    val devices: Boolean? = null,
)

@Serializable
data class DiagnosticsSettings(
    val level: DiagnosticsLevel,
    @SerialName("verbose_until") val verboseUntil: Long? = null,
)

@Serializable
data class OwnMileageRate(
    @SerialName("cents_per_unit") val centsPerUnit: Double,
    val unit: DistanceUnit,
)

@Serializable
data class Logbook(
    val readings: String,
    val notes: List<String> = emptyList(),
)

// ---------------------------------------------------------------------------------------------
// Vehicles

/** `GET /vehicles` items. `kind`, `power` and `ownership` stay strings (shown, not branched on). */
@Serializable
data class Vehicle(
    val id: Long,
    val name: String,
    val kind: String,
    val make: String? = null,
    val model: String? = null,
    val year: Int? = null,
    val plate: String? = null,
    val power: String? = null,
    val ownership: String? = null,
    @SerialName("created_at") val createdAt: Long? = null,
    @SerialName("archived_at") val archivedAt: Long? = null,
)

// ---------------------------------------------------------------------------------------------
// Shifts, odometer, trips (requests)

/** `POST /shifts` (ShiftStart). Idempotent on client_id. */
@Serializable
data class ShiftStart(
    @SerialName("client_id") val clientId: String,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("started_at") val startedAt: Long,
    val segmenter: Segmenter? = null,
    /** Sent only when there are some (a shift created again after a restore keeps its notes). */
    val notes: String? = null,
)

/** `PATCH /shifts/{ref}`: the phone edits notes. */
@Serializable
data class ShiftPatch(
    val notes: String? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("updated_at") val updatedAt: Long? = null,
)

/** `PUT /shifts/{ref}/odometer/{kind}`. Whole metres. */
@Serializable
data class OdometerPut(
    @SerialName("reading_m") val readingM: Long,
    @SerialName("recorded_at") val recordedAt: Long,
)

/** `PUT /shifts/{ref}/trip-overrides/{trip_key}`: an automatic trip's kind or purpose. */
@Serializable
data class TripOverridePut(
    val kind: TripKind,
    val purpose: String,
    @SerialName("edited_at") val editedAt: Long,
)

/** `PUT /shifts/{ref}/trips/{client_id}` (ManualTripPut: TripCreate plus edited_at). */
@Serializable
data class ManualTripPut(
    val kind: TripKind,
    @SerialName("started_at") val startedAt: Long,
    @SerialName("ended_at") val endedAt: Long,
    @SerialName("distance_m") val distanceM: Long,
    val purpose: String,
    @SerialName("edited_at") val editedAt: Long,
)

/** `POST /shifts/{ref}/end`. Only `ended_at` when the phone has nothing else to report. */
@Serializable
data class ShiftEnd(
    @SerialName("ended_at") val endedAt: Long,
    val manifest: PointManifest? = null,
    @SerialName("phone_result") val phoneResult: PhoneResult? = null,
    val interruptions: List<Interruption>? = null,
)

/** Which points of the shift the phone holds (15 section 6.1). */
@Serializable
data class PointManifest(
    @SerialName("first_seq") val firstSeq: Long,
    @SerialName("last_seq") val lastSeq: Long,
    @SerialName("point_count") val pointCount: Long,
)

/** The phone's own engine result for a shift, sent with its end (14 section 9.3). */
@Serializable
data class PhoneResult(
    @SerialName("calc_version") val calcVersion: Int,
    val segmenter: Segmenter,
    /** 16 lower-case hex characters. */
    @SerialName("input_digest") val inputDigest: String,
    @SerialName("total_m") val totalM: Long,
    @SerialName("active_m") val activeM: Long,
    @SerialName("deadhead_m") val deadheadM: Long,
    @SerialName("personal_m") val personalM: Long,
    /** Automatic trips only. */
    @SerialName("trips_count") val tripsCount: Int,
)

@Serializable
data class Interruption(
    @SerialName("from_ms") val fromMs: Long,
    @SerialName("to_ms") val toMs: Long,
)

// ---------------------------------------------------------------------------------------------
// Shifts, odometer, trips (answers)

@Serializable
data class Shift(
    val id: Long,
    @SerialName("client_id") val clientId: String,
    @SerialName("vehicle_id") val vehicleId: Long,
    val status: ShiftStatus,
    val segmenter: Segmenter,
    @SerialName("started_at") val startedAt: Long,
    @SerialName("ended_at") val endedAt: Long? = null,
    /** YYYY-MM-DD in the instance zone. */
    @SerialName("local_date") val localDate: String,
    @SerialName("total_m") val totalM: Long? = null,
    @SerialName("active_m") val activeM: Long? = null,
    @SerialName("deadhead_m") val deadheadM: Long? = null,
    @SerialName("personal_m") val personalM: Long? = null,
    @SerialName("calc_version") val calcVersion: Int? = null,
    @SerialName("calculated_at") val calculatedAt: Long? = null,
    val notes: String? = null,
    @SerialName("deduction_cents") val deductionCents: Long? = null,
    @SerialName("updated_at") val updatedAt: Long? = null,
    /** pending, match, differs or phone_missing. */
    @SerialName("recon_status") val reconStatus: String? = null,
    @SerialName("recon_reasons") val reconReasons: List<String> = emptyList(),
    @SerialName("calc_mismatch") val calcMismatch: Boolean? = null,
    val flags: List<ShiftFlag> = emptyList(),
    @SerialName("overlaps_shift_id") val overlapsShiftId: Long? = null,
)

@Serializable
data class ShiftFlag(
    val code: String,
    /** info or review. */
    val severity: String,
    val detail: JsonObject? = null,
)

/** How the server's total compares with the phone's (present when the end carried a phone_result). */
@Serializable
data class Recon(
    val status: String,
    @SerialName("server_total_m") val serverTotalM: Long? = null,
    @SerialName("diff_m") val diffM: Long? = null,
    val reasons: List<String> = emptyList(),
)

/** `POST /shifts/{ref}/end` answers the Shift with `recon` beside its fields (allOf). */
@Serializable(with = EndShiftResultSerializer::class)
data class EndShiftResult(val shift: Shift, val recon: Recon? = null)

/** Reads and writes [EndShiftResult] as one flat object: the Shift's fields plus `recon`. */
object EndShiftResultSerializer : KSerializer<EndShiftResult> {
    private val shiftDescriptor = Shift.serializer().descriptor

    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("EndShiftResult") {
        for (i in 0 until shiftDescriptor.elementsCount) {
            element(
                shiftDescriptor.getElementName(i),
                shiftDescriptor.getElementDescriptor(i),
                isOptional = shiftDescriptor.isElementOptional(i),
            )
        }
        element("recon", Recon.serializer().descriptor, isOptional = true)
    }

    override fun deserialize(decoder: Decoder): EndShiftResult {
        val json = decoder as? JsonDecoder ?: throw SerializationException("EndShiftResult reads JSON only")
        val obj = json.decodeJsonElement().jsonObject
        val shift = json.json.decodeFromJsonElement(Shift.serializer(), obj)
        val recon = obj["recon"]?.takeIf { it is JsonObject }?.let { json.json.decodeFromJsonElement(Recon.serializer(), it) }
        return EndShiftResult(shift, recon)
    }

    override fun serialize(encoder: Encoder, value: EndShiftResult) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("EndShiftResult writes JSON only")
        val shift = json.json.encodeToJsonElement(Shift.serializer(), value.shift).jsonObject
        json.encodeJsonElement(
            buildJsonObject {
                shift.forEach { (k, v) -> put(k, v) }
                value.recon?.let { put("recon", json.json.encodeToJsonElement(Recon.serializer(), it)) }
            },
        )
    }
}

@Serializable
data class OdometerReading(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("shift_id") val shiftId: Long? = null,
    /** shift_start, shift_end, year_start or year_end. */
    val kind: String,
    @SerialName("reading_m") val readingM: Long,
    @SerialName("recorded_at") val recordedAt: Long,
)

@Serializable
data class Trip(
    val id: Long,
    @SerialName("shift_id") val shiftId: Long,
    @SerialName("trip_key") val tripKey: String? = null,
    val kind: TripKind,
    @SerialName("original_kind") val originalKind: TripKind? = null,
    /** auto or manual. */
    val source: String,
    @SerialName("started_at") val startedAt: Long,
    @SerialName("ended_at") val endedAt: Long,
    @SerialName("start_lat_e7") val startLatE7: Long? = null,
    @SerialName("start_lon_e7") val startLonE7: Long? = null,
    @SerialName("end_lat_e7") val endLatE7: Long? = null,
    @SerialName("end_lon_e7") val endLonE7: Long? = null,
    @SerialName("distance_m") val distanceM: Long,
    val purpose: String,
    @SerialName("edited_at") val editedAt: Long? = null,
)

/** The answer to a trip edit: the trip (null for an orphaned override) and the recomputed shift. */
@Serializable
data class TripEditResult(
    val trip: Trip? = null,
    val shift: Shift,
)

// ---------------------------------------------------------------------------------------------
// Points (tracking module)

/** `POST /telemetry/batch`, sent gzipped. 1 to 500 points of one shift. */
@Serializable
data class TelemetryBatch(
    @SerialName("shift_client_id") val shiftClientId: String,
    val points: List<TelemetryPoint>,
) {
    companion object {
        /** The most points the contract takes in one batch. */
        const val MAX_POINTS = 500
    }
}

@Serializable
data class TelemetryPoint(
    val seq: Long,
    @SerialName("recorded_at") val recordedAt: Long,
    @SerialName("lat_e7") val latE7: Long,
    @SerialName("lon_e7") val lonE7: Long,
    @SerialName("accuracy_m") val accuracyM: Long,
    @SerialName("speed_dmps") val speedDmps: Long?,
    @SerialName("bearing_deg") val bearingDeg: Long?,
    @SerialName("altitude_m") val altitudeM: Long?,
)

@Serializable
data class TelemetryBatchResult(
    val inserted: Int,
    val duplicates: Int,
    val rejected: List<RejectedPoint> = emptyList(),
    @SerialName("server_time") val serverTime: Long,
    @SerialName("upload_hint_s") val uploadHintS: Int,
)

@Serializable
data class RejectedPoint(
    val seq: Long,
    /** invalid_coordinate, future_timestamp or outside_shift_window. */
    val code: String,
)

// ---------------------------------------------------------------------------------------------
// The change feed (sync module)

/** `GET /sync/changes?after=&limit=`. */
@Serializable
data class SyncChanges(
    val changes: List<ChangeEntry>,
    @SerialName("next_cursor") val nextCursor: Long,
    @SerialName("has_more") val hasMore: Boolean,
)

@Serializable
data class ChangeEntry(
    val seq: Long,
    /** shift, trip, odometer, vehicle, settings or override ([ChangeEntity]). */
    val entity: String,
    /** upsert, delete or orphaned_override. */
    val op: String,
    val key: String,
    /** The entity in its API shape; null for a delete. Decode it with the entity's model. */
    val data: JsonObject? = null,
)

/** The `entity` values of [ChangeEntry] this app knows. */
object ChangeEntity {
    const val SHIFT = "shift"
    const val TRIP = "trip"
    const val ODOMETER = "odometer"
    const val VEHICLE = "vehicle"
    const val SETTINGS = "settings"
    const val OVERRIDE = "override"
}

// ---------------------------------------------------------------------------------------------
// Diagnostics

/** `POST /diagnostics/events`, sent gzipped. 1 to 200 events. */
@Serializable
data class DiagIngestRequest(val events: List<DiagEventIn>) {
    companion object {
        const val MAX_EVENTS = 200
    }
}

@Serializable
data class DiagEventIn(
    val kind: String,
    val at: Long,
    val level: DiagEventLevel,
    val src: DiagSource,
    /** Required for phone sources; strictly increasing per (device, src). */
    val seq: Long? = null,
    /** Shift client_id. */
    val shift: String? = null,
    /** App version. */
    val v: String,
    /** Typed fields per kind (the shared diagnostics registry). */
    val data: JsonObject,
)

@Serializable
data class DiagIngestResult(
    val accepted: Int,
    val duplicates: Int,
    val discarded: Int,
    val rejected: List<RejectedEvent> = emptyList(),
)

@Serializable
data class RejectedEvent(val index: Int, val reason: String)
