package app.milewage.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/**
 * One operation of the contract, as the phone calls it. [path] is the spec's template
 * (`/shifts/{ref}/end`), relative to `/api/v1` unless [root]. ContractDriftTest checks every entry of
 * [Api.all] against openapi.yaml: the path and method exist, the request model matches the request
 * body schema, and the response model matches the schema of each status in [bodyStatuses].
 */
class Endpoint<Req, Res>(
    val operationId: String,
    val method: HttpMethod,
    val path: String,
    /** Null for operations without a body (GET). */
    val request: KSerializer<Req>?,
    val response: KSerializer<Res>,
    /** Success statuses whose body is [response]. */
    val bodyStatuses: Set<Int>,
    /** Sent with the device token. */
    val auth: Boolean = true,
    /** The body goes gzipped. */
    val gzip: Boolean = false,
    /** Outside `/api/v1` (only `/healthz`). */
    val root: Boolean = false,
) {
    /** [path] with each `{name}` replaced by its percent-encoded value. */
    fun pathWith(params: Map<String, String> = emptyMap()): String {
        var p = path
        for ((name, value) in params) {
            val slot = "{$name}"
            require(slot in p) { "$operationId has no path parameter $name" }
            p = p.replace(slot, percentEncode(value))
        }
        require('{' !in p) { "$operationId: missing path parameters in $p" }
        return p
    }

    override fun toString(): String = "$operationId ($method $path)"
}

/** Every operation the phone calls. The models are in Models.kt. */
object Api {
    val health = Endpoint<Unit, Health>(
        "getHealth", HttpMethod.GET, "/healthz", null, Health.serializer(), setOf(200), auth = false, root = true,
    )

    // Pairing: no device token yet.
    val redeem = Endpoint(
        "redeemPairingToken", HttpMethod.POST, "/pairing/redeem",
        RedeemRequest.serializer(), Paired.serializer(), setOf(201), auth = false,
    )

    val settings = Endpoint<Unit, Settings>("getSettings", HttpMethod.GET, "/settings", null, Settings.serializer(), setOf(200))
    val vehicles = Endpoint<Unit, List<Vehicle>>(
        "listVehicles", HttpMethod.GET, "/vehicles", null, ListSerializer(Vehicle.serializer()), setOf(200),
    )

    // Shift changes (the outbox and the shift screens; ShiftRequests builds them).
    val startShift = Endpoint(
        "startShift", HttpMethod.POST, "/shifts", ShiftStart.serializer(), Shift.serializer(), setOf(200, 201),
    )
    val updateShift = Endpoint(
        "updateShift", HttpMethod.PATCH, "/shifts/{ref}", ShiftPatch.serializer(), Shift.serializer(), setOf(200),
    )
    val setOdometer = Endpoint(
        "setShiftOdometer", HttpMethod.PUT, "/shifts/{ref}/odometer/{kind}",
        OdometerPut.serializer(), OdometerReading.serializer(), setOf(200),
    )
    val putTripOverride = Endpoint(
        "putTripOverride", HttpMethod.PUT, "/shifts/{ref}/trip-overrides/{trip_key}",
        TripOverridePut.serializer(), TripEditResult.serializer(), setOf(200),
    )
    val putManualTrip = Endpoint(
        "putManualTrip", HttpMethod.PUT, "/shifts/{ref}/trips/{client_id}",
        ManualTripPut.serializer(), TripEditResult.serializer(), setOf(200),
    )
    val endShift = Endpoint(
        "endShift", HttpMethod.POST, "/shifts/{ref}/end", ShiftEnd.serializer(), EndShiftResult.serializer(), setOf(200),
    )
    val uploadPoints = Endpoint(
        "uploadTelemetryBatch", HttpMethod.POST, "/telemetry/batch",
        TelemetryBatch.serializer(), TelemetryBatchResult.serializer(), setOf(200), gzip = true,
    )

    /** Query: `after` (cursor, default 0) and `limit` (1 to 200). */
    val pullChanges = Endpoint<Unit, SyncChanges>(
        "pullChanges", HttpMethod.GET, "/sync/changes", null, SyncChanges.serializer(), setOf(200),
    )

    val diagnostics = Endpoint(
        "ingestDiagnosticEvents", HttpMethod.POST, "/diagnostics/events",
        DiagIngestRequest.serializer(), DiagIngestResult.serializer(), setOf(200), gzip = true,
    )

    val all: List<Endpoint<*, *>> = listOf(
        health, redeem, settings, vehicles,
        startShift, updateShift, setOdometer, putTripOverride, putManualTrip, endShift,
        uploadPoints, pullChanges, diagnostics,
    )
}

/** RFC 3986 percent-encoding of one path segment or query value: only unreserved characters stay. */
fun percentEncode(value: String): String = buildString {
    for (b in value.encodeToByteArray()) {
        val c = b.toInt() and 0xff
        val ch = c.toChar()
        if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
            append(ch)
        } else {
            append('%')
            append(HEX[c shr 4])
            append(HEX[c and 0xf])
        }
    }
}

private const val HEX = "0123456789ABCDEF"
