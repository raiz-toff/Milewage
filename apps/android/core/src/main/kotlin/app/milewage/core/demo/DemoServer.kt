package app.milewage.core.demo

import app.milewage.core.api.ApiJson
import app.milewage.core.api.DiagIngestRequest
import app.milewage.core.api.DiagIngestResult
import app.milewage.core.api.EndShiftResult
import app.milewage.core.api.Health
import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.HttpMethod
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.ManualTripPut
import app.milewage.core.api.MileWageHeaders
import app.milewage.core.api.OdometerPut
import app.milewage.core.api.OdometerReading
import app.milewage.core.api.Paired
import app.milewage.core.api.Problem
import app.milewage.core.api.Recon
import app.milewage.core.api.Segmenter
import app.milewage.core.api.Shift
import app.milewage.core.api.ShiftEnd
import app.milewage.core.api.ShiftStart
import app.milewage.core.api.ShiftStatus
import app.milewage.core.api.SyncChanges
import app.milewage.core.api.TelemetryBatch
import app.milewage.core.api.TelemetryBatchResult
import app.milewage.core.api.Trip
import app.milewage.core.api.TripEditResult
import app.milewage.core.api.TripOverridePut
import app.milewage.core.api.Vehicle
import app.milewage.core.ports.Clock
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.Summaries
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer

/**
 * The demo's MileWage server, in the app's own process: an [HttpTransport] that answers every
 * operation the phone calls (`Api.all`) for [Demo.BASE_URL] without a network. It keeps nothing:
 * each answer is built from the request and from the phone's own record of the shift ([shift]),
 * so it agrees with the phone's numbers (no Difference) and works the same after a restart.
 */
class DemoServer(
    private val clock: Clock,
    /** The phone's own record of a shift, by client id (the database); null when it has none. */
    private val shift: suspend (clientId: String) -> ShiftRecord? = { null },
) : HttpTransport {
    override suspend fun exchange(request: HttpRequest): HttpResponse {
        val rest = request.url.removePrefix(Demo.BASE_URL)
        val path = rest.substringBefore('?').removePrefix("/api/v1")
        val query = rest.substringAfter('?', "").split('&').filter { it.isNotEmpty() }
            .associate { it.substringBefore('=') to it.substringAfter('=', "") }
        val parts = path.split('/').drop(1)
        val m = request.method
        return when {
            m == HttpMethod.GET && path == "/healthz" -> ok(Health.serializer(), Health(true))
            m == HttpMethod.POST && path == "/pairing/redeem" -> ok(
                Paired.serializer(),
                Paired(deviceId = 1, deviceToken = TOKEN, settings = settings()),
                status = 201,
            )
            m == HttpMethod.GET && path == "/settings" -> ok(app.milewage.core.api.Settings.serializer(), settings())
            m == HttpMethod.GET && path == "/vehicles" -> ok(ListSerializer(Vehicle.serializer()), Demo.VEHICLES.map { Vehicle(it.id, it.name, it.kind, plate = it.plate) })
            m == HttpMethod.GET && path == "/sync/changes" -> {
                val after = query["after"]?.toLongOrNull() ?: 0
                ok(SyncChanges.serializer(), SyncChanges(emptyList(), nextCursor = after, hasMore = false))
            }
            m == HttpMethod.POST && path == "/diagnostics/events" -> {
                val n = body(request, DiagIngestRequest.serializer())?.events?.size ?: 0
                ok(DiagIngestResult.serializer(), DiagIngestResult(accepted = n, duplicates = 0, discarded = 0))
            }
            m == HttpMethod.POST && path == "/telemetry/batch" -> {
                val n = body(request, TelemetryBatch.serializer())?.points?.size ?: 0
                ok(TelemetryBatchResult.serializer(), TelemetryBatchResult(inserted = n, duplicates = 0, serverTime = clock.nowMs(), uploadHintS = 60))
            }
            m == HttpMethod.POST && path == "/shifts" -> {
                val start = body(request, ShiftStart.serializer()) ?: return problem(422, "validation_failed")
                val s = Shift(
                    id = idOf(start.clientId), clientId = start.clientId, vehicleId = start.vehicleId, status = ShiftStatus.ACTIVE,
                    segmenter = start.segmenter ?: Segmenter.STOPS, startedAt = start.startedAt,
                    localDate = Summaries.today(start.startedAt, Demo.TIMEZONE), notes = start.notes, updatedAt = clock.nowMs(),
                )
                ok(Shift.serializer(), s, status = 201)
            }
            parts.firstOrNull() == "shifts" && parts.size >= 2 -> shiftOperation(request, parts)
            else -> problem(404, "not_found")
        }
    }

    private suspend fun shiftOperation(request: HttpRequest, parts: List<String>): HttpResponse {
        val id = parts[1]
        val local = shift(id)
        val m = request.method
        return when {
            m == HttpMethod.POST && parts.getOrNull(2) == "end" -> {
                val end = body(request, ShiftEnd.serializer()) ?: return problem(422, "validation_failed")
                val phone = end.phoneResult
                val s = shiftOf(id, local).copy(
                    status = ShiftStatus.ENDED,
                    endedAt = end.endedAt,
                    totalM = phone?.totalM ?: local?.distances?.totalM,
                    activeM = phone?.activeM ?: local?.distances?.activeM,
                    deadheadM = phone?.deadheadM ?: local?.distances?.deadheadM,
                    personalM = phone?.personalM ?: local?.distances?.personalM,
                    calcVersion = phone?.calcVersion ?: local?.calcVersion,
                    reconStatus = if (phone == null) "phone_missing" else "match",
                )
                // The demo's "server" ran the phone's own numbers: always a match, never a Difference.
                val recon = if (phone == null) Recon("phone_missing") else Recon("match", serverTotalM = phone.totalM, diffM = 0)
                ok(EndShiftResult.serializer(), EndShiftResult(s, recon))
            }
            m == HttpMethod.PUT && parts.getOrNull(2) == "odometer" -> {
                val put = body(request, OdometerPut.serializer()) ?: return problem(422, "validation_failed")
                val s = shiftOf(id, local)
                ok(OdometerReading.serializer(), OdometerReading(idOf(id + parts.getOrNull(3)), s.vehicleId, s.id, parts.getOrNull(3) ?: "shift_start", put.readingM, put.recordedAt))
            }
            m == HttpMethod.PUT && parts.getOrNull(2) == "trip-overrides" -> {
                val put = body(request, TripOverridePut.serializer()) ?: return problem(422, "validation_failed")
                val s = shiftOf(id, local)
                val key = parts.getOrNull(3) ?: ""
                val trip = Trip(
                    idOf(key), s.id, key, put.kind, source = "auto", startedAt = s.startedAt, endedAt = s.endedAt ?: s.startedAt,
                    distanceM = 0, purpose = put.purpose, editedAt = put.editedAt,
                )
                ok(TripEditResult.serializer(), TripEditResult(trip, s))
            }
            m == HttpMethod.PUT && parts.getOrNull(2) == "trips" -> {
                val put = body(request, ManualTripPut.serializer()) ?: return problem(422, "validation_failed")
                val s = shiftOf(id, local)
                val key = parts.getOrNull(3) ?: ""
                val trip = Trip(idOf(key), s.id, key, put.kind, put.kind, "manual", put.startedAt, put.endedAt, distanceM = put.distanceM, purpose = put.purpose, editedAt = put.editedAt)
                ok(TripEditResult.serializer(), TripEditResult(trip, s))
            }
            m == HttpMethod.PATCH && parts.size == 2 -> ok(Shift.serializer(), shiftOf(id, local))
            else -> problem(404, "not_found")
        }
    }

    /** The phone's shift as the server would answer it. */
    private fun shiftOf(clientId: String, r: ShiftRecord?): Shift = Shift(
        id = r?.serverId ?: idOf(clientId),
        clientId = clientId,
        vehicleId = r?.vehicleId ?: Demo.VEHICLES.first().id,
        status = when (r?.status) {
            app.milewage.core.shift.ShiftStatus.RUNNING -> ShiftStatus.ACTIVE
            app.milewage.core.shift.ShiftStatus.FINALIZED -> ShiftStatus.FINALIZED
            else -> ShiftStatus.ENDED
        },
        segmenter = r?.segmenter ?: Segmenter.STOPS,
        startedAt = r?.startedAt ?: clock.nowMs(),
        endedAt = r?.endedAt,
        localDate = r?.localDate ?: Summaries.today(clock.nowMs(), Demo.TIMEZONE),
        totalM = r?.distances?.totalM,
        activeM = r?.distances?.activeM,
        deadheadM = r?.distances?.deadheadM,
        personalM = r?.distances?.personalM,
        calcVersion = r?.calcVersion,
        notes = r?.notes,
        updatedAt = clock.nowMs(),
        reconStatus = r?.recon?.wire,
    )

    private fun settings() = Demo.settings(Summaries.today(clock.nowMs(), Demo.TIMEZONE).take(4))

    private fun <T> body(request: HttpRequest, serializer: KSerializer<T>): T? =
        request.body?.let { runCatching { ApiJson.decodeFromString(serializer, it.decodeToString()) }.getOrNull() }

    private fun <T> ok(serializer: KSerializer<T>, value: T, status: Int = 200): HttpResponse =
        HttpResponse(status, headers("application/json"), ApiJson.encodeToString(serializer, value).encodeToByteArray())

    private fun problem(status: Int, code: String): HttpResponse = HttpResponse(
        status,
        headers("application/problem+json"),
        ApiJson.encodeToString(Problem.serializer(), Problem(title = code, status = status, code = code)).encodeToByteArray(),
    )

    private fun headers(type: String) = HttpHeaders(
        mapOf(
            "Content-Type" to type,
            MileWageHeaders.API to MileWageHeaders.API_VERSION,
            MileWageHeaders.INSTANCE to Demo.INSTANCE,
            MileWageHeaders.RESTORE_GEN to "1",
            MileWageHeaders.SERVER_TIME to clock.nowMs().toString(),
        ),
    )

    companion object {
        /** The demo's device token: the shape the pairing layer checks, and nothing more. */
        const val TOKEN = "mwd_demoDemoDemoDemoDemoDemoDemoDemoDemoDemoDem"

        /** A stable positive id for a key (the demo server keeps no table). */
        fun idOf(key: String): Long = (key.hashCode().toLong() and 0x7fff_ffffL) + 1

        /**
         * [real] for every address but the demo's; the demo's requests never reach it, so no network
         * call goes out in demo mode.
         */
        fun routing(demo: HttpTransport, real: HttpTransport): HttpTransport = HttpTransport { request ->
            if (isDemoUrl(request.url)) demo.exchange(request) else real.exchange(request)
        }

        fun isDemoUrl(url: String): Boolean =
            url == Demo.BASE_URL || url.startsWith(Demo.BASE_URL + "/") || url.startsWith(Demo.BASE_URL + "?")
    }
}
