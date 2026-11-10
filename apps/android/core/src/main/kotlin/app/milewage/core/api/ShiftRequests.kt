package app.milewage.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.math.roundToLong

/**
 * What the phone tells the server about a shift, encoded once (08 sections 4 and 5, 15 section 6.2;
 * decision 2026-11-09). Every place that sends a shift change, straight away or through the outbox,
 * builds its request here from the phone's own records; the bodies are the contract's models, so a
 * field the spec changes fails ContractDriftTest and nowhere else. A port of the Expo app's
 * `sync/shiftRequests.ts`.
 */

/** Every change type, by the name the outbox stores. */
enum class ChangeType(val wire: String) {
    SHIFT_CREATE("shift.create"),
    SHIFT_PATCH("shift.patch"),
    ODOMETER_PUT("odometer.put"),
    TRIP_OVERRIDE("trip.override"),
    TRIP_MANUAL("trip.manual"),
    SHIFT_END("shift.end"),

    /** Points go through the upload worker, not the outbox. */
    TELEMETRY_BATCH("telemetry.batch"),
    ;

    /** The changes that wait in the outbox. */
    val queued: Boolean get() = this != TELEMETRY_BATCH

    companion object {
        fun of(wire: String): ChangeType? = entries.firstOrNull { it.wire == wire }
    }
}

/** One change to a shift, in the phone's own terms. */
sealed interface ShiftChange {
    val type: ChangeType

    data class Create(
        val clientId: String,
        val vehicleId: Long,
        val startedAt: Long,
        val segmenter: Segmenter,
        /** Sent only when there are some (a shift created again after a restore keeps its notes). */
        val notes: String? = null,
    ) : ShiftChange {
        override val type get() = ChangeType.SHIFT_CREATE
    }

    data class Patch(val clientId: String, val notes: String, val updatedAt: Long) : ShiftChange {
        override val type get() = ChangeType.SHIFT_PATCH
    }

    data class Odometer(
        val clientId: String,
        val reading: ShiftOdometer,
        /** Metres; rounded to whole metres here. */
        val readingM: Double,
        val recordedAt: Long,
    ) : ShiftChange {
        override val type get() = ChangeType.ODOMETER_PUT
    }

    /** An automatic trip's kind or purpose. [tripKey] starts with the shift's client id. */
    data class Override(val tripKey: String, val kind: TripKind, val purpose: String, val editedAt: Long) : ShiftChange {
        override val type get() = ChangeType.TRIP_OVERRIDE
    }

    data class ManualTrip(
        val clientId: String,
        /** The trip's own UUID. */
        val tripKey: String,
        val kind: TripKind,
        val startedAt: Long,
        val endedAt: Long,
        val distanceM: Long,
        val purpose: String,
        val editedAt: Long,
    ) : ShiftChange {
        override val type get() = ChangeType.TRIP_MANUAL
    }

    data class End(
        val clientId: String,
        val endedAt: Long,
        /** Null when the phone has no points: then only `ended_at` (and interruptions) is sent. */
        val manifest: PointManifest? = null,
        val phoneResult: PhoneResult? = null,
        /** Gaps the phone knows of (location off, app killed); sent only when there are some. */
        val interruptions: List<Interruption> = emptyList(),
    ) : ShiftChange {
        override val type get() = ChangeType.SHIFT_END
    }

    data class Points(val clientId: String, val points: List<TelemetryPoint>) : ShiftChange {
        override val type get() = ChangeType.TELEMETRY_BATCH
    }
}

/**
 * One request, ready to send or to keep in the outbox (`kind`, `entityKey` and `body` are stored;
 * [ShiftRequests.requestFor] gives the same request back). A point batch goes gzipped.
 */
data class ShiftRequest(
    val kind: ChangeType,
    /** The shift's client id, then what the change is about; see [ShiftRequests.route]. */
    val entityKey: String,
    val method: HttpMethod,
    val path: String,
    val body: JsonObject,
) {
    val gzip: Boolean get() = kind == ChangeType.TELEMETRY_BATCH
}

object ShiftRequests {
    /** The shift a request is about: every entity key starts with the shift's client id (a UUID). */
    fun shiftOf(entityKey: String): String = entityKey.substringBefore(':')

    /** The contract operation of each change type. */
    fun endpointOf(kind: ChangeType): Endpoint<*, *> = when (kind) {
        ChangeType.SHIFT_CREATE -> Api.startShift
        ChangeType.SHIFT_PATCH -> Api.updateShift
        ChangeType.ODOMETER_PUT -> Api.setOdometer
        ChangeType.TRIP_OVERRIDE -> Api.putTripOverride
        ChangeType.TRIP_MANUAL -> Api.putManualTrip
        ChangeType.SHIFT_END -> Api.endShift
        ChangeType.TELEMETRY_BATCH -> Api.uploadPoints
    }

    /**
     * Entity keys: shift `client_id`; `<shift>:<odometer kind>`; `<shift>:<segment ms>:<kind>` (an
     * automatic trip's key); `<shift>:<trip uuid>` (a manual trip).
     */
    fun route(kind: ChangeType, entityKey: String): Pair<HttpMethod, String> {
        val shift = shiftOf(entityKey)
        val rest = entityKey.drop(shift.length + 1)
        val endpoint = endpointOf(kind)
        val path = when (kind) {
            ChangeType.SHIFT_CREATE, ChangeType.TELEMETRY_BATCH -> endpoint.pathWith()
            ChangeType.SHIFT_PATCH, ChangeType.SHIFT_END -> endpoint.pathWith(mapOf("ref" to shift))
            ChangeType.ODOMETER_PUT -> endpoint.pathWith(mapOf("ref" to shift, "kind" to rest))
            ChangeType.TRIP_OVERRIDE -> endpoint.pathWith(mapOf("ref" to shift, "trip_key" to entityKey))
            ChangeType.TRIP_MANUAL -> endpoint.pathWith(mapOf("ref" to shift, "client_id" to rest))
        }
        return endpoint.method to path
    }

    /** The request for one change. Bodies hold exactly the contract's fields, nothing of the phone's own. */
    fun encode(c: ShiftChange): ShiftRequest = when (c) {
        is ShiftChange.Create -> request(
            c.type, c.clientId, ShiftStart.serializer(),
            ShiftStart(c.clientId, c.vehicleId, c.startedAt, c.segmenter, c.notes),
        )
        is ShiftChange.Patch -> request(c.type, c.clientId, ShiftPatch.serializer(), ShiftPatch(notes = c.notes, updatedAt = c.updatedAt))
        is ShiftChange.Odometer -> request(
            c.type, "${c.clientId}:${c.reading.wire}", OdometerPut.serializer(),
            OdometerPut(c.readingM.roundToLong(), c.recordedAt),
        )
        is ShiftChange.Override -> request(c.type, c.tripKey, TripOverridePut.serializer(), TripOverridePut(c.kind, c.purpose, c.editedAt))
        is ShiftChange.ManualTrip -> request(
            c.type, "${c.clientId}:${c.tripKey}", ManualTripPut.serializer(),
            ManualTripPut(c.kind, c.startedAt, c.endedAt, c.distanceM, c.purpose, c.editedAt),
        )
        is ShiftChange.End -> request(
            c.type, c.clientId, ShiftEnd.serializer(),
            ShiftEnd(c.endedAt, c.manifest, c.phoneResult, c.interruptions.ifEmpty { null }),
        )
        is ShiftChange.Points -> request(c.type, c.clientId, TelemetryBatch.serializer(), TelemetryBatch(c.clientId, c.points))
    }

    /** The request for an outbox row: its path comes from its kind and entity key, as when queued. */
    fun requestFor(kind: ChangeType, entityKey: String, body: JsonObject): ShiftRequest {
        val (method, path) = route(kind, entityKey)
        return ShiftRequest(kind, entityKey, method, path, body)
    }

    /**
     * The batch size to try after the server refused a point batch of [sent] points as too large
     * (413) or as holding a point it cannot take (422): half of it, so the bad point is found or the
     * batch fits. Null when halving cannot help (one point, or another refusal).
     */
    fun halvedBatch(e: ApiException, sent: Int): Int? =
        if ((e.status == 413 || e.status == 422) && sent > 1) maxOf(1, sent / 2) else null

    private fun <T> request(kind: ChangeType, entityKey: String, serializer: KSerializer<T>, body: T): ShiftRequest {
        val (method, path) = route(kind, entityKey)
        return ShiftRequest(kind, entityKey, method, path, ApiJson.encodeToJsonElement(serializer, body).jsonObject)
    }
}
