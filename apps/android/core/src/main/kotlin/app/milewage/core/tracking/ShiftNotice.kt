package app.milewage.core.tracking

import app.milewage.core.format.DistanceUnit
import app.milewage.core.format.TimeFormat
import app.milewage.core.format.dayOf
import app.milewage.core.format.formatClock
import app.milewage.core.format.formatDistance
import kotlin.math.roundToLong

/**
 * What the running-shift notification says. The app sets the parts that do not change during a
 * shift ([shiftNotice] builds them); the tracker counts the distance itself as fixes arrive, so
 * the notification stays current while the app is in the background. A port of the Expo
 * tracker's `ShiftNotice.kt` with the same texts.
 */
data class ShiftNotice(
    val startedAt: Long,
    val unit: DistanceUnit = DistanceUnit.KM,
    /** Distance of the shifts already ended today, in metres. */
    val earlierM: Long = 0,
    val earlierShifts: Int = 0,
    /** Start time and vehicle, for example "Started 09:02 · Toyota Prius". */
    val footer: String = "",
) {
    /** One figure of the Android 17+ metric layout. */
    sealed interface Metric {
        /** Short label under the figure (Android asks for 10 characters or fewer). */
        val label: String

        /** A distance, rounded to one decimal so equal readings compare equal. */
        data class Distance(override val label: String, val value: Float, val unit: String) : Metric

        /** A clock counting up from [since] (epoch ms); the system ticks it, not the app. */
        data class Elapsed(override val label: String, val since: Long) : Metric
    }

    /**
     * Android 8 to 16: [title], [text] and, only when it says more, [expanded] (BigTextStyle); the
     * clock is the header's chronometer. Android 17+: [metricTitle], [subText] in the header and
     * [metrics] (MetricStyle, which shows no content text). [chip] is the status-bar chip text.
     */
    data class Text(
        val title: String,
        val text: String,
        val expanded: String?,
        val chip: String,
        val metricTitle: String,
        val subText: String?,
        val metrics: List<Metric>,
    )

    fun text(shiftM: Long): Text {
        val shift = formatDistance(shiftM, unit)
        val todayM = earlierM + shiftM
        // Today's total only says something new once a shift has already ended today.
        val today = if (earlierShifts > 0) "Today ${formatDistance(todayM, unit)} · ${earlierShifts + 1} shifts" else null
        val details = footer.ifBlank { null }
        val lines = listOfNotNull(today, details)
        val metrics = buildList {
            add(Metric.Distance("Shift", amount(shiftM), unit.label))
            add(Metric.Elapsed("Time", startedAt))
            if (earlierShifts > 0) add(Metric.Distance("Today", amount(todayM), unit.label))
        }
        return Text(
            title = "$shift this shift",
            text = lines.firstOrNull() ?: "Shift in progress",
            expanded = if (lines.size > 1) lines.joinToString("\n") else null,
            chip = shift,
            metricTitle = "Shift in progress",
            subText = details,
            metrics = metrics,
        )
    }

    private fun amount(m: Long): Float = ((m / unit.metres) * 10).roundToLong() / 10f

    /** For the state store, so a restarted service shows the same details. */
    fun encode(): String = Snapshot.Builder()
        .put("startedAt", startedAt)
        .put("unit", unit.name)
        .put("earlierM", earlierM)
        .put("earlierShifts", earlierShifts)
        .put("footer", footer)
        .encode()

    companion object {
        /** Reads [encode]'s text; missing or wrong values take safe defaults (as the Expo `fromMap`). */
        fun decode(text: String?, fallbackStart: Long): ShiftNotice {
            val s = Snapshot.decode(text)
            return ShiftNotice(
                startedAt = s.long("startedAt") ?: fallbackStart,
                unit = if (s.string("unit") == DistanceUnit.MI.name) DistanceUnit.MI else DistanceUnit.KM,
                earlierM = (s.long("earlierM") ?: 0).coerceAtLeast(0),
                earlierShifts = (s.int("earlierShifts") ?: 0).coerceAtLeast(0),
                footer = s.string("footer")?.take(120) ?: "",
            )
        }
    }
}

/** The fields of a stored shift that [shiftNotice] reads (the phone's `shifts` table). */
data class NoticeShiftRow(
    val clientId: String,
    /** The instance-local date of the shift's start, "YYYY-MM-DD". */
    val localDate: String,
    /** "active", "ended" or "finalized". */
    val status: String,
    val totalM: Long?,
)

/**
 * What the running-shift notification says around the distance: today's shifts that already
 * ended (by the instance's local date of the shift's start), and a footer with the start time and
 * vehicle. A port of apps/phone/src/shift/notice.ts.
 */
fun shiftNotice(
    clientId: String,
    startedAt: Long,
    vehicle: String?,
    rows: List<NoticeShiftRow>,
    unit: DistanceUnit,
    timeZone: String,
    timeFormat: TimeFormat = TimeFormat.H24,
): ShiftNotice {
    val day = dayOf(startedAt, timeZone).toString()
    val earlier = rows.filter { it.clientId != clientId && it.localDate == day && it.status != "active" && it.totalM != null }
    val started = "Started ${formatClock(startedAt, timeZone, timeFormat)}"
    return ShiftNotice(
        startedAt = startedAt,
        unit = unit,
        earlierM = earlier.sumOf { it.totalM!! },
        earlierShifts = earlier.size,
        footer = if (!vehicle.isNullOrBlank()) "$started · $vehicle" else started,
    )
}
