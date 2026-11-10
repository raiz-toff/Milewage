package app.milewage.data.support

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okio.Buffer
import okio.GzipSource
import okio.buffer

/**
 * A MileWage server as far as plan 08 goes for the phone, on a real HTTP server (MockWebServer):
 * shifts by client id (200 unchanged when known, one active shift per user), fixes by seq with
 * duplicates counted, `end` answered from the stored result once ended, the change log, and
 * [backup] / [restore] that raise the restore generation. Every answer carries the identity headers.
 */
class FakeMileWage(var instance: String = "inst-A") {
    /** One request: its method, path, body (unzipped) and the size of the body as it arrived. */
    data class Call(val method: String, val path: String, val body: JsonElement?, val wireBytes: Long = 0) {
        override fun toString() = "$method $path"
    }

    class ShiftRow(val id: Long, val clientId: String, val vehicleId: Long, val startedAt: Long, var status: String = "active", var ended: JsonObject? = null)

    class State(
        val shifts: LinkedHashMap<String, ShiftRow> = LinkedHashMap(),
        val points: HashMap<String, MutableSet<Long>> = HashMap(),
        val odometer: HashMap<String, Long> = HashMap(),
    ) {
        fun copy() = State(
            LinkedHashMap(shifts.mapValues { (_, s) -> ShiftRow(s.id, s.clientId, s.vehicleId, s.startedAt, s.status, s.ended) }),
            HashMap(points.mapValues { it.value.toMutableSet() }),
            HashMap(odometer),
        )
    }

    val server = MockWebServer()
    val calls = java.util.Collections.synchronizedList(ArrayList<Call>())
    var state = State()
    var gen = 1L
    var duplicates = 0
    var conflicts = 0

    /** Per-route answers that win over the default: `"POST /shifts"` to a handler (null: default). */
    val overrides = HashMap<String, (Call) -> MockResponse?>()

    /** What the server's recalculation adds to the phone's total (0: a match). */
    var recalcDiffM = 0L

    /** The change log: entries after the cursor. */
    val changes = ArrayList<JsonObject>()

    var settings: JsonObject = SETTINGS

    val url: String get() = server.url("/").toString().trimEnd('/')

    fun start(): FakeMileWage {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = synchronized(this@FakeMileWage) { handle(request) }
        }
        server.start()
        return this
    }

    fun close() = server.close()

    fun backup(): State = state.copy()

    fun restore(snapshot: State) {
        state = snapshot.copy()
        gen++
    }

    /** Writes (not GETs), as `METHOD /path`. */
    fun writes(from: Int = 0): List<String> = synchronized(calls) { calls.drop(from).filter { it.method != "GET" }.map { it.toString() } }

    fun ok(status: Int, body: JsonElement): MockResponse = MockResponse.Builder().code(status)
        .addHeader("Content-Type", "application/json")
        .addHeader("X-MileWage-Api", "1")
        .addHeader("X-MileWage-Instance", instance)
        .addHeader("X-MileWage-Restore-Gen", gen.toString())
        .body(body.toString())
        .build()

    fun problem(status: Int, code: String, retryable: Boolean = false, vararg headers: Pair<String, String>): MockResponse =
        MockResponse.Builder().code(status)
            .addHeader("Content-Type", "application/problem+json")
            .addHeader("X-MileWage-Api", "1")
            .addHeader("X-MileWage-Instance", instance)
            .addHeader("X-MileWage-Restore-Gen", gen.toString())
            .apply { headers.forEach { (k, v) -> addHeader(k, v) } }
            .body(buildJsonObject { put("type", "about:blank"); put("title", code); put("status", status); put("code", code); put("retryable", retryable) }.toString())
            .build()

    private fun bodyOf(r: RecordedRequest): JsonElement? {
        val bytes = r.body ?: return null
        if (bytes.size == 0) return null
        val text = if (r.headers["Content-Encoding"] == "gzip") {
            GzipSource(Buffer().write(bytes)).buffer().readUtf8()
        } else {
            bytes.utf8()
        }
        return Json.parseToJsonElement(text)
    }

    fun shiftJson(s: ShiftRow): JsonObject {
        val phone = s.ended?.get("phone_result") as? JsonObject
        val total = phone?.get("total_m")?.jsonPrimitive?.longOrNull?.let { it + recalcDiffM }
        return buildJsonObject {
            put("id", s.id)
            put("client_id", s.clientId)
            put("vehicle_id", s.vehicleId)
            put("status", s.status)
            put("segmenter", "stops")
            put("started_at", s.startedAt)
            put("ended_at", s.ended?.get("ended_at") ?: JsonNull)
            put("local_date", "2026-11-01")
            if (s.ended != null) {
                put("total_m", total?.let(::JsonPrimitive) ?: JsonNull)
                put("active_m", total?.let(::JsonPrimitive) ?: JsonNull)
                put("deadhead_m", 0)
                put("personal_m", 0)
                put("calc_version", 4)
            }
        }
    }

    private fun endAnswer(s: ShiftRow): JsonObject {
        val phone = (s.ended?.get("phone_result") as? JsonObject)?.get("total_m")?.jsonPrimitive?.longOrNull
        val shift = shiftJson(s)
        val recon = if (phone == null) {
            buildJsonObject { put("status", "phone_missing"); put("reasons", JsonArray(emptyList())) }
        } else {
            buildJsonObject {
                put("status", if (recalcDiffM == 0L) "match" else "differs")
                put("server_total_m", phone + recalcDiffM)
                put("diff_m", recalcDiffM)
                put("reasons", if (recalcDiffM == 0L) JsonArray(emptyList()) else buildJsonArray { add(JsonPrimitive("points_missing")) })
            }
        }
        return JsonObject(shift + ("recon" to recon))
    }

    private fun handle(r: RecordedRequest): MockResponse {
        val url = r.url
        val path = url.encodedPath.removePrefix("/api/v1")
        val call = Call(r.method, path, bodyOf(r), r.body?.size?.toLong() ?: 0)
        calls.add(call)
        overrides["${call.method} ${call.path}"]?.invoke(call)?.let { return it }
        val parts = path.split('/').drop(1)
        val body = call.body as? JsonObject
        return when {
            call.method == "GET" && path == "/healthz" -> ok(200, buildJsonObject { put("ok", true) })
            call.method == "GET" && path == "/settings" -> ok(200, settings)
            call.method == "POST" && path == "/pairing/redeem" ->
                ok(201, buildJsonObject { put("device_id", 2); put("device_token", "mwd_" + "n".repeat(43)); put("settings", settings) })
            call.method == "GET" && path == "/vehicles" -> ok(200, buildJsonArray { add(buildJsonObject { put("id", 3); put("name", "Civic"); put("kind", "car") }) })
            call.method == "GET" && path == "/sync/changes" -> {
                val after = url.queryParameter("after")?.toLong() ?: 0
                val page = changes.filter { it["seq"]!!.jsonPrimitive.long > after }
                ok(200, buildJsonObject {
                    put("changes", JsonArray(page))
                    put("next_cursor", page.lastOrNull()?.get("seq")?.jsonPrimitive?.long ?: after)
                    put("has_more", false)
                })
            }
            call.method == "POST" && path == "/diagnostics/events" ->
                ok(200, buildJsonObject { put("accepted", body!!["events"]!!.jsonArray.size); put("duplicates", 0); put("discarded", 0); put("rejected", JsonArray(emptyList())) })
            call.method == "POST" && path == "/shifts" -> {
                val id = body!!["client_id"]!!.jsonPrimitive.content
                state.shifts[id]?.let { return ok(200, shiftJson(it)) }
                if (state.shifts.values.any { it.status == "active" }) {
                    conflicts++
                    return problem(409, "shift_already_active")
                }
                val s = ShiftRow(state.shifts.size + 100L, id, body["vehicle_id"]!!.jsonPrimitive.long, body["started_at"]!!.jsonPrimitive.long)
                state.shifts[id] = s
                ok(201, shiftJson(s))
            }
            call.method == "POST" && path == "/telemetry/batch" -> {
                val id = body!!["shift_client_id"]!!.jsonPrimitive.content
                if (id !in state.shifts) return problem(404, "shift_not_found")
                val set = state.points.getOrPut(id) { HashSet() }
                var inserted = 0
                for (p in body["points"]!!.jsonArray) {
                    if (set.add(p.jsonObject["seq"]!!.jsonPrimitive.long)) inserted++ else duplicates++
                }
                ok(200, buildJsonObject {
                    put("inserted", inserted)
                    put("duplicates", body["points"]!!.jsonArray.size - inserted)
                    put("rejected", JsonArray(emptyList()))
                    put("server_time", 1)
                    put("upload_hint_s", 60)
                })
            }
            parts.firstOrNull() == "shifts" && parts.size >= 2 -> {
                val s = state.shifts[parts[1]] ?: return problem(404, "shift_not_found")
                when {
                    call.method == "POST" && parts.getOrNull(2) == "end" -> {
                        if (s.status == "active") {
                            s.status = "ended"
                            s.ended = body
                        }
                        ok(200, endAnswer(s))
                    }
                    call.method == "PUT" && parts.getOrNull(2) == "odometer" -> {
                        state.odometer["${parts[1]}:${parts[3]}"] = body!!["reading_m"]!!.jsonPrimitive.long
                        ok(200, buildJsonObject {
                            put("id", 7); put("vehicle_id", s.vehicleId); put("shift_id", s.id); put("kind", parts[3])
                            put("reading_m", body["reading_m"]!!); put("recorded_at", body["recorded_at"]!!)
                        })
                    }
                    call.method == "PATCH" -> ok(200, shiftJson(s))
                    call.method == "PUT" -> ok(200, buildJsonObject { put("shift", shiftJson(s)) })
                    else -> problem(404, "not_found")
                }
            }
            else -> problem(404, "not_found")
        }
    }

    companion object {
        val SETTINGS: JsonObject = buildJsonObject {
            put("country", "CA")
            put("distance_unit", "km")
            put("currency", "CAD")
            put("timezone", "UTC")
            put("stops_enabled", true)
            put("engine_version", 4)
            put("diagnostics", buildJsonObject { put("level", "basic") })
            put("modules", buildJsonObject { put("tracking", true); put("stops", true); put("sync", true); put("diagnostics", true) })
        }
    }
}
