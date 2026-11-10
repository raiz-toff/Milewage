package app.milewage.phone.model

import app.milewage.core.api.MileageRate
import app.milewage.core.api.Settings
import app.milewage.core.format.DASH
import app.milewage.core.format.DistanceUnit
import app.milewage.core.format.TimeFormat
import app.milewage.core.format.dayOf
import app.milewage.core.format.formatClock
import app.milewage.core.format.formatDay
import app.milewage.core.format.formatDistance
import app.milewage.core.format.formatDuration
import app.milewage.core.format.formatMoney
import app.milewage.core.pairing.Flags
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber

/**
 * What the screens need from the paired server's cached settings to show numbers the driver's way:
 * the unit, the currency, the instance's time zone (never the phone's), 12 or 24 hours, the country
 * (day order), the week start and the feature flags. Before the first settings read (or unpaired, in
 * a debug build) the plainest reading: kilometres, UTC, 24 hours.
 */
data class DisplaySettings(
    val unit: DistanceUnit = DistanceUnit.KM,
    val currency: String = "USD",
    val timezone: String = "UTC",
    val timeFormat: TimeFormat = TimeFormat.H24,
    val country: String = "",
    /** 0 Sunday, 1 Monday. */
    val weekStart: Int = 1,
    /** The deduction is worked out at the driver's own rate: always labelled "your rate". */
    val yourRate: Boolean = false,
    /** Stops and the estimated active/deadhead split are shown (the server's stops module and setting). */
    val stops: Boolean = false,
    /** The server's tracking module: without it the tracker does not run during a shift. */
    val tracking: Boolean = true,
    val defaultVehicleId: Long? = null,
) {
    companion object {
        fun of(s: Settings?): DisplaySettings {
            if (s == null) return DisplaySettings()
            val flags = Flags.of(s)
            return DisplaySettings(
                unit = if (s.distanceUnit == app.milewage.core.api.DistanceUnit.MI) DistanceUnit.MI else DistanceUnit.KM,
                currency = s.currency,
                timezone = s.timezone,
                timeFormat = if (s.timeFormat == "12h") TimeFormat.H12 else TimeFormat.H24,
                country = s.country,
                weekStart = s.weekStart ?: 1,
                // The same rule as MileWageData.ratesOf: the own rate applies when chosen, or when no choice is stored.
                yourRate = s.ownMileageRate != null && (s.mileageRate == MileageRate.YOURS || s.mileageRate == null),
                stops = flags.stops,
                tracking = flags.tracking,
                defaultVehicleId = s.defaultVehicleId,
            )
        }
    }
}

private val WEEKDAYS = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/**
 * Every number on a screen goes through here, in the driver's settings, using `:core`'s formatters
 * (the same rules as the web and the Expo app). Plain Kotlin, tested on the JVM.
 */
class Formats(val s: DisplaySettings) {
    fun distance(m: Long?): String = formatDistance(m, s.unit)

    /** The figure alone ("12.3"), for a large reading with its unit set apart. */
    fun distanceNumber(m: Long?): String = formatDistance(m, s.unit).substringBefore(' ')

    val unitLabel: String get() = s.unit.label

    fun money(cents: Long?): String = formatMoney(cents, s.currency)

    fun clock(atMs: Long): String = formatClock(atMs, s.timezone, s.timeFormat)

    /** "11:00–15:30", or "11:00" while running. */
    fun range(startMs: Long, endMs: Long?): String = if (endMs == null) clock(startMs) else "${clock(startMs)}–${clock(endMs)}"

    fun duration(startMs: Long, endMs: Long?): String = formatDuration(startMs, endMs)

    fun dayOf(atMs: Long): LocalDate = dayOf(atMs, s.timezone)

    /** "Nov 9, 2026" or "9 Nov 2026" by the driver's country. */
    fun day(date: LocalDate): String = formatDay(date, s.country)

    /** "Mon, Nov 9" or "Mon, 9 Nov": a row in a list where the year is in the heading. */
    fun shortDay(date: LocalDate): String {
        val wd = WEEKDAYS[date.dayOfWeek.isoDayNumber - 1].take(3)
        val month = MONTHS[date.month.ordinal]
        return if (formatDay(date, s.country).first().isLetter()) "$wd, $month ${date.day}" else "$wd, ${date.day} $month"
    }

    /** "Monday, Nov 9, 2026": a screen title. */
    fun longDay(date: LocalDate): String = "${WEEKDAYS[date.dayOfWeek.isoDayNumber - 1]}, ${day(date)}"

    /** An odometer reading: whole units with thousands commas ("12,346 km"). */
    fun odometer(m: Long?): String {
        if (m == null) return DASH
        val whole = kotlin.math.floor(m / s.unit.metres + 0.5).toLong()
        return whole.toString().reversed().chunked(3).joinToString(",").reversed() + " " + s.unit.label
    }

    companion object {
        /** "1:04:09": hours, minutes and seconds of a running shift. */
        fun elapsed(ms: Long): String {
            val t = maxOf(0L, ms / 1000)
            fun two(n: Long) = n.toString().padStart(2, '0')
            return "${t / 3600}:${two(t / 60 % 60)}:${two(t % 60)}"
        }
    }
}
