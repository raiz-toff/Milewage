package app.milewage.core.shift

import app.milewage.core.api.DistanceUnit
import app.milewage.core.format.dayOf
import app.milewage.core.tracking.RecordedFix
import app.milewage.engine.LiveAccumulator
import app.milewage.engine.createLiveAccumulator
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlin.math.roundToLong

/**
 * Mileage rates as the summary needs them: a port seam for `@milewage/shared`'s country packs
 * (`mileageDeduction`, `periodStart`). [OwnRate] is the driver's own rate; the country packs are not
 * ported yet (see data/README.md), so a shift the server has not valued is estimated with the
 * driver's own rate or not at all, never guessed.
 */
interface MileageRates {
    /** Key of the rate period that contains [date] (tiers restart there). */
    fun periodOf(date: String): String

    /** Cents for [businessM] metres on [date] after [priorM] metres in the same period; null: no rate. */
    fun deduction(businessM: Long, priorM: Long, date: String, vehicleKind: String): Long?

    /** No rate: the server's values only. */
    object None : MileageRates {
        override fun periodOf(date: String) = ""

        override fun deduction(businessM: Long, priorM: Long, date: String, vehicleKind: String): Long? = null
    }

    /**
     * The second step of the driver's own rate (ADR 0012): the rate after [thresholdUnits] km or
     * miles of the rate period that starts on [periodStart], and what the server has counted in that
     * period so far, by vehicle kind.
     */
    data class Step(val thresholdUnits: Long, val centsPerUnitAfter: Double, val periodStart: String, val serverM: Map<String, Long>)

    /**
     * The driver's own rate (plan 21 Q5, ADR 0007); never for a non-automobile. With a [step] the
     * distance is split at the threshold as the server does it: the server's count for the period
     * first, then the shifts the phone has not sent ([deduction]'s `priorM`), then this shift.
     */
    class OwnRate(private val centsPerUnit: Double, private val unit: DistanceUnit, private val step: Step? = null) : MileageRates {
        /** The rate period of [date]: the year that starts on the step's month and day. */
        override fun periodOf(date: String): String {
            val s = step ?: return ""
            val start = date.take(4) + s.periodStart.drop(4)
            return if (date >= start) start else "${date.take(4).toInt() - 1}${s.periodStart.drop(4)}"
        }

        override fun deduction(businessM: Long, priorM: Long, date: String, vehicleKind: String): Long? {
            if (vehicleKind in NOT_AUTOMOBILE) return null
            val unitM = if (unit == DistanceUnit.KM) 1000.0 else 1609.344
            val s = step ?: return (businessM / unitM * centsPerUnit).roundToLong()
            // The server's count belongs to its own period; a shift in another one starts from the phone's.
            val counted = priorM + if (periodOf(date) == s.periodStart) s.serverM[vehicleKind] ?: 0 else 0
            val firstM = (s.thresholdUnits * unitM - counted).coerceIn(0.0, businessM.toDouble())
            // Rounded twice, as the server does: to 1/100 cent, then to a whole cent.
            val hundredths = ((firstM * centsPerUnit + (businessM - firstM) * s.centsPerUnitAfter) / unitM * 100).roundToLong()
            return (hundredths / 100.0).roundToLong()
        }
    }

    companion object {
        /** No mileage allowance applies (18 section 4.1). */
        val NOT_AUTOMOBILE = setOf("bicycle", "ebike", "scooter", "walking")
    }
}

data class PeriodSummary(
    val from: String,
    val to: String,
    val shifts: Int,
    /** Shifts in the period not yet sent to the server. */
    val unsent: Int,
    val totalM: Long,
    val businessM: Long,
    /** Deduction value in cents; null when no rate applies (never a guess). */
    val deductionCents: Long?,
)

data class HomeSummary(val day: PeriodSummary, val week: PeriodSummary, val month: PeriodSummary)

/**
 * The home screen's figures from the shifts on the phone (15 section 4: unsent shifts included,
 * with a count), a port of the Expo app's `store/summary.ts`. Only ended or finalized shifts with a
 * result count. The deduction is worked out on the business distance (total minus personal trips,
 * ADR 0005): the server's value wins for a shift the change log sent; others are estimated with
 * [MileageRates], with the business metres already driven in the same rate period first.
 */
object Summaries {
    /** The first day of the week containing [date]; [weekStart] 1 is Monday (default), 0 Sunday. */
    fun weekStart(date: String, weekStart: Int = 1): String {
        val d = LocalDate.parse(date)
        val first = if (weekStart == 0) DayOfWeek.SUNDAY else DayOfWeek.MONDAY
        val back = (d.dayOfWeek.isoDayNumber - first.isoDayNumber + 7) % 7
        return d.minus(DatePeriod(days = back)).toString()
    }

    fun summarize(
        rows: List<ShiftRecord>,
        today: String,
        rates: MileageRates,
        vehicleKinds: Map<Long, String>,
        weekStart: Int = 1,
    ): HomeSummary {
        val done = rows.filter { it.status != ShiftStatus.RUNNING && it.distances != null }
            .sortedWith(compareBy<ShiftRecord>({ it.localDate }, { it.startedAt }))
        val values = valuesOf(done, rates, vehicleKinds)
        fun period(from: String): PeriodSummary {
            val inside = done.filter { it.localDate in from..today }
            val priced = inside.mapNotNull { values[it.clientId] }
            return PeriodSummary(
                from = from,
                to = today,
                shifts = inside.size,
                unsent = inside.count { it.sendState != SendState.SENT },
                totalM = inside.sumOf { it.distances!!.totalM },
                businessM = inside.sumOf { it.distances!!.businessM },
                deductionCents = if (priced.isEmpty()) null else priced.sum(),
            )
        }
        return HomeSummary(period(today), period(weekStart(today, weekStart)), period("${today.take(7)}-01"))
    }

    /** Each shift's value in cents (null: none), in date order so a tiered rate counts earlier shifts first. */
    private fun valuesOf(done: List<ShiftRecord>, rates: MileageRates, kinds: Map<Long, String>): Map<String, Long?> {
        val prior = HashMap<String, Long>()
        val out = HashMap<String, Long?>()
        for (r in done) {
            val kind = kinds[r.vehicleId] ?: "car"
            val key = "$kind|${rates.periodOf(r.localDate)}"
            val before = prior[key] ?: 0
            val business = r.distances!!.businessM
            out[r.clientId] = if (r.serverDeductionKnown) r.serverDeductionCents else rates.deduction(business, before, r.localDate, kind)
            // A shift the server has valued is in the server's own count (the rate's step carries it).
            if (!r.serverDeductionKnown) prior[key] = before + business
        }
        return out
    }

    /**
     * The running shift's deduction value so far (cents; null: no rate), as if it ended now: what
     * it adds to its month after the shifts before it. A running shift has no personal trips yet,
     * so all of its distance is business until the driver marks a trip personal after the end.
     */
    fun runningValue(
        rows: List<ShiftRecord>,
        running: ShiftRecord,
        distanceM: Long,
        rates: MileageRates,
        vehicleKinds: Map<Long, String>,
    ): Long? {
        val self = running.copy(status = ShiftStatus.ENDED, distances = Distances(distanceM, 0, 0, 0), serverDeductionKnown = false, clientId = running.clientId + ":running")
        val others = rows.filter { it.clientId != running.clientId }
        val with = summarize(others + self, running.localDate, rates, vehicleKinds).month.deductionCents ?: return null
        return with - (summarize(others, running.localDate, rates, vehicleKinds).month.deductionCents ?: 0)
    }

    fun today(nowMs: Long, timezone: String): String = dayOf(nowMs, timezone).toString()
}

/**
 * The running shift's distance from the stored fixes, with the engine's live accumulator (stages
 * 1 to 3, the same functions as the end), read incrementally: each call reads only the fixes stored
 * since the last one. Shown to the driver; the end's engine run is the authority.
 */
class LiveTotals(private val read: suspend (shiftClientId: String, afterSeq: Long, limit: Int) -> List<RecordedFix>) {
    private var shift: String? = null
    private var acc: LiveAccumulator? = null
    private var lastSeq = 0L

    suspend fun distanceM(running: ShiftRecord): Long {
        if (shift != running.clientId) {
            shift = running.clientId
            acc = createLiveAccumulator(running.startedAt)
            lastSeq = 0
        }
        val a = acc!!
        while (true) {
            val page = read(running.clientId, lastSeq, PAGE)
            for (f in page) a.push(ShiftRun.toFix(f))
            lastSeq = page.lastOrNull()?.seq ?: lastSeq
            if (page.size < PAGE) break
        }
        return a.runningTotalM()
    }

    private companion object {
        const val PAGE = 2_000
    }
}

/**
 * Whether to ask for the odometer after a shift ends (Comma's cadence, a port of the Expo app's
 * `shift/odometerDue.ts`): once a month and whenever 14 days have passed since the last check. A
 * vehicle never checked is asked now (the baseline).
 */
object OdometerDue {
    const val EVERY_MS = 14 * 24 * 60 * 60_000L

    fun due(now: Long, zone: String, lastCheck: Long?): Boolean {
        if (lastCheck == null) return true
        if (now - lastCheck >= EVERY_MS) return true
        return dayOf(lastCheck, zone).toString().take(7) != dayOf(now, zone).toString().take(7)
    }

    fun key(vehicleId: Long) = "odometer.checked.$vehicleId"

    /** The newer of the vehicle's newest reading on any shift and the last answered or dismissed prompt. */
    suspend fun lastCheck(store: LocalStore, vehicleId: Long): Long? {
        val read = store.lastOdometerAt(vehicleId)
        val asked = store.get(key(vehicleId))?.toLongOrNull()?.takeIf { it > 0 }
        return listOfNotNull(read, asked).maxOrNull()
    }

    suspend fun markChecked(store: LocalStore, vehicleId: Long, at: Long) = store.put(key(vehicleId), at.toString())
}
