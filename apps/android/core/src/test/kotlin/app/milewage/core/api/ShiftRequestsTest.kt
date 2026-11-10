package app.milewage.core.api

import app.milewage.core.support.Contract
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Expo app's shiftRequests.test.ts: one request per shift change, routed as the contract says,
 * with a body the contract's request schema accepts (validated against openapi.yaml).
 */
class ShiftRequestsTest {
    private val a = "11111111-1111-4111-8111-111111111111"
    private val trip = "99999999-9999-4999-8999-999999999999"
    private val autoTrip = "$a:1700000000000:deadhead"

    private fun point(seq: Long, speed: Long? = 120, bearing: Long? = 90, altitude: Long? = 80) =
        TelemetryPoint(seq, 1_700_000_000_000 + seq * 1000, 436_532_000, -793_832_000, 5, speed, bearing, altitude)

    private data class Case(val change: ShiftChange, val kind: ChangeType, val key: String, val method: HttpMethod, val path: String)

    private val cases = listOf(
        Case(ShiftChange.Create(a, 3, 1_000, Segmenter.STOPS), ChangeType.SHIFT_CREATE, a, HttpMethod.POST, "/shifts"),
        Case(ShiftChange.Patch(a, "Airport run", 2_000), ChangeType.SHIFT_PATCH, a, HttpMethod.PATCH, "/shifts/$a"),
        Case(
            ShiftChange.Odometer(a, ShiftOdometer.SHIFT_START, 12_345_678.4, 1_000),
            ChangeType.ODOMETER_PUT, "$a:shift_start", HttpMethod.PUT, "/shifts/$a/odometer/shift_start",
        ),
        Case(
            ShiftChange.Override(autoTrip, TripKind.PERSONAL, "Lunch", 3_000),
            ChangeType.TRIP_OVERRIDE, autoTrip, HttpMethod.PUT, "/shifts/$a/trip-overrides/${percentEncode(autoTrip)}",
        ),
        Case(
            ShiftChange.ManualTrip(a, trip, TripKind.DEADHEAD, 1_000, 2_000, 4_200, "Back to the zone", 5_000),
            ChangeType.TRIP_MANUAL, "$a:$trip", HttpMethod.PUT, "/shifts/$a/trips/$trip",
        ),
        Case(
            ShiftChange.End(
                a, 9_000, PointManifest(1, 40, 40),
                PhoneResult(1, Segmenter.STOPS, "0123456789abcdef", 12_000, 8_000, 3_000, 1_000, 3),
                listOf(Interruption(4_000, 5_000)),
            ),
            ChangeType.SHIFT_END, a, HttpMethod.POST, "/shifts/$a/end",
        ),
        Case(
            ShiftChange.Points(a, listOf(point(1), point(2, speed = null, bearing = null, altitude = null))),
            ChangeType.TELEMETRY_BATCH, a, HttpMethod.POST, "/telemetry/batch",
        ),
    )

    /** The contract's verdict on a request: no problems, or what is wrong. */
    private fun accepts(req: ShiftRequest): List<String> {
        val endpoint = ShiftRequests.endpointOf(req.kind)
        val schema = Contract.requestSchema(endpoint.method.name, endpoint.path) ?: error("no body for $endpoint")
        return Contract.validate(schema, req.body)
    }

    @Test
    fun coversEveryChangeType() {
        assertEquals(ChangeType.entries.toSet(), cases.map { it.kind }.toSet())
        assertEquals(ChangeType.entries.toSet(), ChangeType.entries.map { ChangeType.of(it.wire) }.toSet())
        assertNull(ChangeType.of("shift.delete"))
        assertFalse(ChangeType.TELEMETRY_BATCH.queued)
    }

    @Test
    fun routeEntityKeyAndABodyTheContractAccepts() {
        for (c in cases) {
            val req = ShiftRequests.encode(c.change)
            assertEquals(c.kind, req.kind, c.kind.wire)
            assertEquals(c.key, req.entityKey, c.kind.wire)
            assertEquals(c.method, req.method, c.kind.wire)
            assertEquals(c.path, req.path, c.kind.wire)
            assertEquals(emptyList(), accepts(req), c.kind.wire)
            assertEquals(c.kind == ChangeType.TELEMETRY_BATCH, req.gzip)
        }
    }

    @Test
    fun anOutboxRowGivesBackTheSameRequest() {
        for (c in cases.filter { it.kind.queued }) {
            val req = ShiftRequests.encode(c.change)
            val stored = ApiJson.parseToJsonElement(req.body.toString()).jsonObject
            assertEquals(req, ShiftRequests.requestFor(ChangeType.of(req.kind.wire)!!, req.entityKey, stored), c.kind.wire)
        }
    }

    @Test
    fun theValidatorRefusesWhatTheServerRefuses() {
        val req = ShiftRequests.encode(cases[0].change)
        assertTrue(accepts(req.copy(body = JsonObject(req.body + ("extra" to JsonPrimitive(1))))).isNotEmpty())
        val tripReq = ShiftRequests.encode(cases[3].change)
        assertTrue(accepts(tripReq.copy(body = JsonObject(tripReq.body + ("purpose" to JsonPrimitive(""))))).isNotEmpty())
        val manual = ShiftRequests.encode(cases[4].change)
        assertTrue(accepts(manual.copy(body = JsonObject(manual.body - "edited_at"))).isNotEmpty())
        assertTrue(accepts(manual.copy(body = JsonObject(manual.body + ("distance_m" to JsonPrimitive(0))))).isNotEmpty())
    }

    @Test
    fun createNotesOnlyWhenThereAreSome() {
        val base = ShiftChange.Create(a, 3, 1, Segmenter.WHOLE_SHIFT)
        assertEquals("""{"client_id":"$a","vehicle_id":3,"started_at":1,"segmenter":"whole_shift"}""", ShiftRequests.encode(base).body.toString())
        assertFalse("notes" in ShiftRequests.encode(base.copy(notes = null)).body)
        val kept = ShiftRequests.encode(base.copy(notes = "Kept after a restore"))
        assertEquals(JsonPrimitive("Kept after a restore"), kept.body["notes"])
        assertEquals(emptyList(), accepts(kept))
    }

    @Test
    fun odometerWholeMetres() {
        assertEquals("""{"reading_m":12345678,"recorded_at":1000}""", ShiftRequests.encode(cases[2].change).body.toString())
        assertEquals(2L, ApiJson.decodeFromJsonElement(OdometerPut.serializer(), ShiftRequests.encode(ShiftChange.Odometer(a, ShiftOdometer.SHIFT_END, 1.5, 1)).body).readingM)
    }

    @Test
    fun endOnlyEndedAtWhenThePhoneHasNoPointsAndNoResultOfItsOwn() {
        val bare = ShiftRequests.encode(ShiftChange.End(a, 9))
        assertEquals("""{"ended_at":9}""", bare.body.toString())
        assertEquals(emptyList(), accepts(bare))
        val manifestOnly = ShiftRequests.encode(ShiftChange.End(a, 9, PointManifest(3, 7, 5)))
        assertEquals("""{"ended_at":9,"manifest":{"first_seq":3,"last_seq":7,"point_count":5}}""", manifestOnly.body.toString())
    }

    @Test
    fun pointsAMissingReadingIsLeftOut() {
        val req = ShiftRequests.encode(cases[6].change)
        val second = req.body["points"]!!.let { (it as kotlinx.serialization.json.JsonArray)[1].jsonObject }
        assertEquals(
            """{"seq":2,"recorded_at":1700000002000,"lat_e7":436532000,"lon_e7":-793832000,"accuracy_m":5}""",
            second.toString(),
        )
        assertFalse(second.values.any { it == JsonNull })
    }

    @Test
    fun points500IsTheMostTheContractTakesInOneBatch() {
        val many = (1L..501L).map { point(it) }
        assertEquals(emptyList(), accepts(ShiftRequests.encode(ShiftChange.Points(a, many.take(TelemetryBatch.MAX_POINTS)))))
        assertTrue(accepts(ShiftRequests.encode(ShiftChange.Points(a, many))).isNotEmpty())
        assertTrue(accepts(ShiftRequests.encode(ShiftChange.Points(a, emptyList()))).isNotEmpty())
    }

    @Test
    fun halvedBatch() {
        fun e(status: Int) = ApiException(status, "x", false)
        val table = listOf(
            Triple(413, 500, 250), Triple(422, 500, 250), Triple(413, 3, 1), Triple(422, 2, 1),
            Triple(413, 1, null), Triple(422, 1, null), Triple(400, 500, null), Triple(409, 500, null), Triple(503, 500, null),
        )
        for ((status, sent, next) in table) assertEquals(next, ShiftRequests.halvedBatch(e(status), sent), "$status after $sent")
    }

    @Test
    fun theShiftOfAnEntityKey() {
        assertEquals(a, ShiftRequests.shiftOf(autoTrip))
        assertEquals(a, ShiftRequests.shiftOf(a))
    }
}
