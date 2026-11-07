package expo.modules.commatracker

import java.util.Locale

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
    /** Last line of the expanded view, for example "Started 09:02 · Toyota Prius". */
    val footer: String = "",
) {
    data class Text(
        val title: String,
        val text: String,
        val expanded: String,
        /** The short status-bar chip on Android 16. */
        val chip: String,
    )

    fun text(shiftM: Long): Text {
        val shift = distance(shiftM)
        val today = distance(earlierM + shiftM)
        val todayLine = if (earlierShifts > 0) {
            "Today $today over ${earlierShifts + 1} shifts"
        } else {
            "Today $today · first shift"
        }
        val expanded = listOf(todayLine, footer, "Tap to open MileWage")
            .filter { it.isNotBlank() }
            .joinToString("\n")
        return Text(title = "$shift this shift", text = todayLine, expanded = expanded, chip = shift)
    }

    /** As `formatDistance` in the app: "12.3 km" or "7.6 mi". */
    fun distance(m: Long): String {
        val perUnit = if (unit == "mi") 1609.344 else 1000.0
        return String.format(Locale.US, "%.1f %s", m / perUnit, if (unit == "mi") "mi" else "km")
    }

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
