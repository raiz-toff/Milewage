package app.milewage.phone.logic

import app.milewage.core.api.TripKind
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.Summaries
import app.milewage.core.sync.ShiftMarker
import app.milewage.data.ShiftListItem
import app.milewage.engine.FlagCode
import kotlinx.datetime.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** One row of the shifts list. */
data class ShiftRow(
    val clientId: String,
    val day: LocalDate,
    val startedAt: Long,
    val endedAt: Long?,
    val totalM: Long?,
    val running: Boolean,
    val marker: ShiftMarker,
    val calcSource: CalcSource,
    val vehicle: String?,
    /** Flags worth a look (see [ShiftFlags.review]). */
    val review: Int,
)

/** How a week is named in the list. */
sealed interface WeekTitle {
    data object ThisWeek : WeekTitle

    data object LastWeek : WeekTitle

    data class WeekOf(val start: LocalDate) : WeekTitle
}

/** [totalM]: the distance of the week's shifts that have totals; null when none has yet (a dash, never 0). */
data class ShiftGroup(val start: LocalDate, val title: WeekTitle, val totalM: Long?, val shifts: Int, val rows: List<ShiftRow>)

object ShiftGroups {
    /**
     * Newest first, in weeks that start on the driver's week start, each with its distance. The
     * day of a shift is the instance-local day it started on (its `localDate`), never the phone's.
     */
    fun of(items: List<ShiftListItem>, today: LocalDate, weekStart: Int): List<ShiftGroup> {
        val thisWeek = LocalDate.parse(Summaries.weekStart(today.toString(), weekStart))
        val lastWeek = LocalDate.parse(Summaries.weekStart(LocalDate.fromEpochDays(thisWeek.toEpochDays() - 1).toString(), weekStart))
        return items
            .sortedByDescending { it.shift.startedAt }
            .map { rowOf(it) }
            .groupBy { LocalDate.parse(Summaries.weekStart(it.day.toString(), weekStart)) }
            .map { (start, rows) ->
                ShiftGroup(
                    start = start,
                    title = when (start) {
                        thisWeek -> WeekTitle.ThisWeek
                        lastWeek -> WeekTitle.LastWeek
                        else -> WeekTitle.WeekOf(start)
                    },
                    totalM = rows.mapNotNull { it.totalM }.takeIf { it.isNotEmpty() }?.sum(),
                    shifts = rows.size,
                    rows = rows,
                )
            }
            .sortedByDescending { it.start }
    }

    /** The facade's marker wins: it knows the paired server ("Recorded for another server"). */
    private fun rowOf(item: ShiftListItem) = rowOf(item.shift, item.vehicle?.name).copy(marker = item.marker)

    fun rowOf(s: ShiftRecord, vehicle: String?) = ShiftRow(
        clientId = s.clientId,
        day = LocalDate.parse(s.localDate),
        startedAt = s.startedAt,
        endedAt = s.endedAt,
        totalM = s.distances?.totalM,
        running = s.running,
        marker = ShiftMarker.of(s),
        calcSource = s.calcSource,
        vehicle = vehicle,
        review = ShiftFlags.review(s).size,
    )
}

/** What the driver can do about a check (the web's `shift/advice.ts`); several checks share one. */
enum class FlagAdvice {
    /** Location "Allow all the time" and battery use without limits: the permissions screen. */
    PERMISSIONS,

    /** Keep the phone where it can see the sky. */
    SKY,

    /** Set the phone's date and time to automatic. */
    CLOCK,

    /** End the shift on the phone when work stops. */
    END_ON_PHONE,
}

/**
 * What a flag on a shift means to the driver; the words are in strings.xml (`flag_*`), the same
 * sentences as the web's Checks (`apps/web/src/pages/ShiftFacts.tsx`), with the web's advice.
 */
enum class ShiftFlag(val wire: String, val review: Boolean, val advice: FlagAdvice? = null) {
    GAP_COUNTED("gap_counted", false),
    GAP_LARGE("gap_large", true, FlagAdvice.PERMISSIONS),
    GAP_DROPPED("gap_dropped", true, FlagAdvice.PERMISSIONS),
    TRACKING_INTERRUPTED("tracking_interrupted", true, FlagAdvice.PERMISSIONS),
    SHIFT_AUTO_CLOSED("shift_auto_closed", true, FlagAdvice.END_ON_PHONE),
    NO_STOPS_DETECTED("no_stops_detected", false),
    LONG_STOP("long_stop", true),
    LABEL_ORPHANED("label_orphaned", false),
    POOR_ACCURACY_SHARE("poor_accuracy_share", true, FlagAdvice.SKY),
    LOW_FIX_DENSITY("low_fix_density", true, FlagAdvice.PERMISSIONS),
    CLOCK_SKEW("clock_skew", false, FlagAdvice.CLOCK),
    OVERRIDE_ORPHANED("override_orphaned", true),
    MANUAL_TRIP_PRESENT("manual_trip_present", false),
    CALC_MISMATCH("calc_mismatch", true),

    /** A code this version does not know (a newer server): shown, as "marked for review". */
    OTHER("", true),
    ;

    companion object {
        fun of(wire: String): ShiftFlag = entries.firstOrNull { it.wire == wire && it != OTHER } ?: OTHER

        /** The advice for these flags, each piece once, in the flags' order. */
        fun advice(flags: List<ShiftFlag>): List<FlagAdvice> = flags.mapNotNull { it.advice }.distinct()
    }
}

/**
 * Why the server's total differs from the phone's (the contract's `Recon.reasons`,
 * packages/shared/openapi/openapi.yaml; the server's `processing/recon.ts`).
 */
enum class ReconReason(val wire: String) {
    POINTS_MISSING("points_missing"),
    CALC_VERSION("calc_version"),
    EDITED_ON_WEB("edited_on_web"),
    LATE_POINTS("late_points"),
    ENGINE_DISAGREEMENT("engine_disagreement"),
    UNKNOWN("unknown"),

    /** A reason this version does not know (a newer server). */
    OTHER(""),
    ;

    companion object {
        fun of(wire: String): ReconReason = entries.firstOrNull { it.wire == wire && it != OTHER } ?: OTHER
    }
}

object ShiftFlags {
    /**
     * The flags to show: the server's once it answered (it recomputed the shift), else the phone's,
     * one per kind, those worth a look first.
     */
    fun of(s: ShiftRecord): List<ShiftFlag> {
        val codes = if (s.calcSource == CalcSource.SERVER && s.serverFlags.isNotEmpty()) {
            s.serverFlags.map { it.code }
        } else {
            s.phoneFlags.map { it.code.wire } + s.serverFlags.map { it.code }
        }
        return codes.map(ShiftFlag::of).distinct().sortedBy { !it.review }
    }

    fun review(s: ShiftRecord): List<ShiftFlag> = of(s).filter { it.review }

    /** Every engine flag has a meaning here (a test keeps this in step with the engine). */
    val engineCodes: Set<String> get() = FlagCode.entries.map { it.wire }.toSet()
}

/** What the server changed, for the notice on a shift (15 section 7.4). */
sealed interface OverwriteText {
    val id: Long

    /** The server's recalculation gave another total than the phone's. */
    data class Difference(override val id: Long, val serverM: Long, val phoneM: Long, val reasons: List<ReconReason>) : OverwriteText {
        val diffM: Long get() = kotlin.math.abs(serverM - phoneM)
    }

    data class Deleted(override val id: Long) : OverwriteText

    data class EditNotApplied(override val id: Long) : OverwriteText

    data class Replaced(override val id: Long) : OverwriteText
}

object Overwrites {
    private val json = Json { ignoreUnknownKeys = true }

    private fun obj(text: String?): JsonObject? = text?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }

    fun of(e: OverwriteEntry): OverwriteText {
        val local = obj(e.localJson)
        val server = obj(e.serverJson)
        val localTotal = (local?.get("total_m") as? JsonPrimitive)?.longOrNull
        val serverTotal = (server?.get("total_m") as? JsonPrimitive)?.longOrNull
        if (e.reason == OverwriteReason.RECON_DIFF && localTotal != null && serverTotal != null) {
            val reasons = (server["reasons"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }?.map(ReconReason::of)?.distinct() ?: emptyList()
            return OverwriteText.Difference(e.id, serverTotal, localTotal, reasons)
        }
        if (e.reason == OverwriteReason.DELETED_ON_SERVER) return OverwriteText.Deleted(e.id)
        if ((server?.get("orphaned") as? JsonPrimitive)?.booleanOrNull == true) return OverwriteText.EditNotApplied(e.id)
        return OverwriteText.Replaced(e.id)
    }
}

/** A trip's purpose as the driver chooses it: business (active or deadhead) or personal. */
enum class TripChoice(val kind: TripKind) {
    /** Business, with stops off: one choice. */
    BUSINESS(TripKind.ACTIVE),

    /** Business, on an order or with a passenger (stops on). */
    ACTIVE(TripKind.ACTIVE),

    /** Business, between orders (stops on). */
    DEADHEAD(TripKind.DEADHEAD),
    PERSONAL(TripKind.PERSONAL),
    ;

    companion object {
        /** The choices offered: with stops on the business split is shown, else business or personal. */
        fun offered(stops: Boolean): List<TripChoice> = if (stops) listOf(ACTIVE, DEADHEAD, PERSONAL) else listOf(BUSINESS, PERSONAL)

        fun of(kind: TripKind, stops: Boolean): TripChoice = when (kind) {
            TripKind.PERSONAL -> PERSONAL
            TripKind.DEADHEAD -> if (stops) DEADHEAD else BUSINESS
            TripKind.ACTIVE -> if (stops) ACTIVE else BUSINESS
        }

        /**
         * The kind to store for [choice]: "Business" keeps a business trip's estimated kind (a
         * deadhead stays deadhead), and turns a personal trip back into active.
         */
        fun kindFor(choice: TripChoice, current: TripKind): TripKind =
            if (choice == BUSINESS) (if (current == TripKind.PERSONAL) TripKind.ACTIVE else current) else choice.kind
    }
}

/** The answer to an edit, for a snackbar: what was saved, or why not (with what to do). */
enum class EditOutcome {
    SAVED,
    FINALIZED,
    NO_SHIFT,
    NO_TRIP,
    RUNNING,
    INVALID,
    FAILED,
    ;

    companion object {
        fun of(r: EditResult): EditOutcome = when (r) {
            EditResult.Ok -> SAVED
            is EditResult.Refused -> when (r.reason) {
                EditResult.Reason.NO_SHIFT -> NO_SHIFT
                EditResult.Reason.FINALIZED -> FINALIZED
                EditResult.Reason.RUNNING -> RUNNING
                EditResult.Reason.NO_TRIP -> NO_TRIP
                EditResult.Reason.INVALID -> INVALID
            }
        }
    }
}
