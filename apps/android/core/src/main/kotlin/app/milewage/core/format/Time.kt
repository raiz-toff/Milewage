package app.milewage.core.format

import kotlinx.datetime.IllegalTimeZoneException
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** Settings > Time format. 24h unless the driver chose 12h; never the phone's language. */
enum class TimeFormat { H12, H24 }

/**
 * The instance time zone (`settings.timezone`), never the phone's. An id the time zone database
 * does not know falls back to UTC, as apps/phone/src/format.ts does.
 */
fun zoneOf(id: String): TimeZone = try {
    TimeZone.of(id)
} catch (_: IllegalTimeZoneException) {
    TimeZone.UTC
}

/** Clock time of an instant in the instance zone: "17:05", or "5:05 PM" with the 12h setting. */
fun formatClock(atMs: Long, timeZone: String, timeFormat: TimeFormat = TimeFormat.H24): String {
    val t = Instant.fromEpochMilliseconds(atMs).toLocalDateTime(zoneOf(timeZone))
    val mm = t.minute.toString().padStart(2, '0')
    return when (timeFormat) {
        TimeFormat.H24 -> "${t.hour.toString().padStart(2, '0')}:$mm"
        TimeFormat.H12 -> {
            val h = if (t.hour % 12 == 0) 12 else t.hour % 12
            "$h:$mm ${if (t.hour < 12) "AM" else "PM"}"
        }
    }
}

/** The driver's day of an instant: the date in the instance zone, never UTC's or the phone's. */
fun dayOf(atMs: Long, timeZone: String): LocalDate =
    Instant.fromEpochMilliseconds(atMs).toLocalDateTime(zoneOf(timeZone)).date

/** Hours and minutes between two instants ("1h 05m"); a shift still running is "in progress". */
fun formatDuration(startMs: Long, endMs: Long?): String {
    if (endMs == null) return "in progress"
    // Math.round((end - start) / 60000): halves toward +infinity.
    val mins = maxOf(0L, (endMs - startMs + 30_000).floorDiv(60_000L))
    return "${mins / 60}h ${(mins % 60).toString().padStart(2, '0')}m"
}

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Countries whose English writes the month first ("Nov 7, 2026"). Everyone else: "7 Nov 2026". */
private val MONTH_FIRST = setOf("US", "CA", "PH")

/** A day in the driver's country's order: "Nov 7, 2026" (CA, US) or "7 Nov 2026" (GB). */
fun formatDay(day: LocalDate, country: String): String {
    val month = MONTHS[day.month.ordinal]
    return if (country.uppercase() in MONTH_FIRST) {
        "$month ${day.day}, ${day.year}"
    } else {
        "${day.day} $month ${day.year}"
    }
}
