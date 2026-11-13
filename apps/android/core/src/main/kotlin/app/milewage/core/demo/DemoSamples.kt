package app.milewage.core.demo

import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.Distances
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.StopRecord
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.engine.Engine
import kotlinx.datetime.DatePeriod
import kotlin.time.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/** One sample shift with its result, as the phone keeps it. */
data class DemoSample(
    val shift: ShiftRecord,
    val trips: List<TripRecord>,
    val stops: List<StopRecord>,
    val route: List<RoutePoint>,
)

/**
 * The demo's past: three weeks of evening shifts around Toronto, each a run of trips (to a pickup,
 * then with the order or the passenger) with the stops between them and a route for the sketch.
 * Made from the date alone (the same day always gives the same shift), already "on the server", so
 * Home has a running total and Shifts a list from the first look.
 */
object DemoSamples {
    private const val DAYS = 21
    private val TORONTO = 43.6532 to -79.3832

    fun of(nowMs: Long): List<DemoSample> {
        val tz = TimeZone.of(Demo.TIMEZONE)
        val now = Instant.fromEpochMilliseconds(nowMs).toLocalDateTime(tz)
        val out = ArrayList<DemoSample>()
        // A short morning shift today once it is over, so the day and the week are never empty.
        if (now.time >= LocalTime(10, 30)) out += shift(now.date, LocalTime(7, 30), 0, tz)
        for (back in 1..DAYS) {
            val date = now.date.minus(DatePeriod(days = back))
            // Five evenings a week, not every one.
            if (back % 7 == 2 || back % 7 == 6) continue
            out += shift(date, LocalTime(16, 0 + (back * 7) % 45), back, tz)
        }
        return out
    }

    /** Writes the sample vehicles and shifts (idempotent: the same keys every time). */
    suspend fun seed(store: LocalStore, nowMs: Long) {
        val samples = of(nowMs)
        store.transaction {
            for (v in Demo.VEHICLES) store.upsertVehicle(v)
            for (s in samples) {
                store.upsertShift(s.shift)
                store.replaceResult(s.shift.clientId, s.trips, s.stops, s.route)
            }
        }
    }

    private fun shift(date: LocalDate, start: LocalTime, index: Int, tz: TimeZone): DemoSample {
        val rnd = Random(date.toEpochDays() * 31L + 7)
        val id = Demo.SAMPLE_PREFIX + date
        var t = LocalDateTime(date, start).toInstant(tz).toEpochMilliseconds()
        val startedAt = t
        var lat = TORONTO.first + rnd.nextDouble(-0.03, 0.03)
        var lon = TORONTO.second + rnd.nextDouble(-0.05, 0.05)
        var heading = rnd.nextDouble(0.0, 2 * PI)
        val route = ArrayList<RoutePoint>()
        val trips = ArrayList<TripRecord>()
        val stops = ArrayList<StopRecord>()
        route += point(lat, lon, t)
        // A morning shift is short; evenings have four to six deliveries, each a pair of trips.
        val jobs = if (index == 0) 2 else 4 + rnd.nextInt(3)
        val legs = jobs * 2
        // One evening in four has a personal trip (a meal) in the middle.
        val personalAt = if (index % 4 == 1) (jobs / 2) * 2 else -1
        for (k in 0 until legs + if (personalAt >= 0) 1 else 0) {
            val kind = when {
                k == personalAt -> TripKind.PERSONAL
                (if (personalAt in 0 until k) k - 1 else k) % 2 == 0 -> TripKind.DEADHEAD
                else -> TripKind.ACTIVE
            }
            val tripStart = t
            val (sLat, sLon) = lat to lon
            var metres = 0.0
            repeat(5 + rnd.nextInt(7)) {
                heading += rnd.nextDouble(-0.7, 0.7)
                val step = rnd.nextDouble(250.0, 900.0)
                val nLat = lat + step * cos(heading) / 111_320.0
                val nLon = lon + step * sin(heading) / (111_320.0 * cos(lat * PI / 180))
                metres += haversine(lat, lon, nLat, nLon)
                lat = nLat
                lon = nLon
                t += (step / rnd.nextDouble(7.0, 12.0) * 1000).roundToLong()
                route += point(lat, lon, t)
            }
            trips += TripRecord(
                tripKey = "$id:$k",
                shiftClientId = id,
                serverId = DemoServer.idOf("$id:$k"),
                kind = kind,
                originalKind = kind,
                source = TripSource.AUTO,
                startedAt = tripStart,
                endedAt = t,
                startLatE7 = e7(sLat),
                startLonE7 = e7(sLon),
                endLatE7 = e7(lat),
                endLonE7 = e7(lon),
                distanceM = metres.roundToLong(),
                purpose = if (kind == TripKind.PERSONAL) "Dinner" else "",
                sendState = SendState.SENT,
            )
            // The stop after the trip: a pickup before a trip with the order, a drop-off after it.
            val dwell = 120L + rnd.nextInt(420)
            val role = when (kind) {
                TripKind.DEADHEAD -> "pickup"
                TripKind.ACTIVE -> "dropoff"
                TripKind.PERSONAL -> "other"
            }
            stops += StopRecord("$id:s$k", id, t, t + dwell * 1000, dwell, e7(lat), e7(lon), "high", if (role == "other") "none" else role, role)
            t += dwell * 1000
        }
        val sum = { kind: TripKind -> trips.filter { it.kind == kind }.sumOf { it.distanceM } }
        val total = trips.sumOf { it.distanceM }
        val record = ShiftRecord(
            clientId = id,
            serverId = DemoServer.idOf(id),
            vehicleId = Demo.VEHICLES[if (index % 5 == 3) 1 else 0].id,
            status = ShiftStatus.ENDED,
            segmenter = Segmenter.STOPS,
            startedAt = startedAt,
            endedAt = t,
            localDate = date.toString(),
            distances = Distances(total, sum(TripKind.ACTIVE), sum(TripKind.DEADHEAD), sum(TripKind.PERSONAL)),
            calcVersion = Engine.ALGORITHM_VERSION,
            calcSource = CalcSource.SERVER,
            serverTotalM = total,
            recon = ReconStatus.MATCH,
            notes = if (index == 4) "Long wait at the restaurant on Queen Street." else null,
            updatedAt = t,
            sendState = SendState.SENT,
            instanceId = Demo.INSTANCE,
        )
        return DemoSample(record, trips, stops, route)
    }

    private fun e7(deg: Double): Long = (deg * 1e7).roundToLong()

    private fun point(lat: Double, lon: Double, t: Long) = RoutePoint(e7(lat), e7(lon), t)

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6_371_008.8
        val p1 = lat1 * PI / 180
        val p2 = lat2 * PI / 180
        val dp = p2 - p1
        val dl = (lon2 - lon1) * PI / 180
        val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }
}
