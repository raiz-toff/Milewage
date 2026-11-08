package expo.modules.commatracker

import java.util.Locale
import kotlin.math.roundToLong

/**
 * What the running-shift notification says. The app sends the parts that do not change during a
 * shift (`setNotice`); the distance is counted here as fixes arrive. Pure, so it is unit tested.
 */
data class ShiftNotice(
    val startedAt: Long,
    /** "km" or "mi". */
    val unit: String = "km",
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
        val shift = distance(shiftM)
        val todayM = earlierM + shiftM
        // Today's total only says something new once a shift has already ended today.
        val today = if (earlierShifts > 0) "Today ${distance(todayM)} · ${earlierShifts + 1} shifts" else null
        val details = footer.ifBlank { null }
        val lines = listOfNotNull(today, details)
        val metrics = buildList {
            add(Metric.Distance("Shift", amount(shiftM), unitName()))
            add(Metric.Elapsed("Time", startedAt))
            if (earlierShifts > 0) add(Metric.Distance("Today", amount(todayM), unitName()))
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

    /** As `formatDistance` in the app: "12.3 km" or "7.6 mi". */
    fun distance(m: Long): String =
        String.format(Locale.US, "%.1f %s", m / perUnit(), unitName())

    private fun unitName() = if (unit == "mi") "mi" else "km"

    private fun perUnit() = if (unit == "mi") 1609.344 else 1000.0

    private fun amount(m: Long): Float = ((m / perUnit()) * 10).roundToLong() / 10f

    companion object {
        /** Reads the map `setNotice` receives from JS; missing or wrong keys take safe defaults. */
        fun fromMap(m: Map<String, Any?>, fallbackStart: Long) = ShiftNotice(
            startedAt = (m["startedAt"] as? Number)?.toLong() ?: fallbackStart,
            unit = if (m["unit"] == "mi") "mi" else "km",
            earlierM = (m["earlierM"] as? Number)?.toLong()?.coerceAtLeast(0) ?: 0,
            earlierShifts = (m["earlierShifts"] as? Number)?.toInt()?.coerceAtLeast(0) ?: 0,
            footer = (m["footer"] as? String)?.take(120) ?: "",
        )
    }
}
