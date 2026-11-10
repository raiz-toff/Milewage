package app.milewage.core.format

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The same cases as apps/phone and apps/web's format tests, so the three apps print the same text. */
class FormatTest {
    @Test
    fun distanceInTheDriversUnitWithOneDecimal() {
        assertEquals("12.3 km", formatDistance(12_345, DistanceUnit.KM))
        assertEquals("7.7 mi", formatDistance(12_345, DistanceUnit.MI))
        assertEquals("0.0 km", formatDistance(0, DistanceUnit.KM))
        assertEquals("1.0 mi", formatDistance(1_609, DistanceUnit.MI))
        // halves round up, as toFixed does: 31.25 mi exactly
        assertEquals("31.3 mi", formatDistance(50_292, DistanceUnit.MI))
        assertEquals("0.1 km", formatDistance(50, DistanceUnit.KM))
        assertEquals("0.0 km", formatDistance(49, DistanceUnit.KM))
        assertEquals(DASH, formatDistance(null, DistanceUnit.KM))
    }

    @Test
    fun distanceFieldsConvertToWholeMetres() {
        assertEquals(1_609L, toMetres(1.0, DistanceUnit.MI))
        assertEquals(12_480_500L, parseDistance("12,480.5", DistanceUnit.KM))
        assertEquals(20_085_418L, parseDistance("12480.5", DistanceUnit.MI)) // node: Math.round(12480.5 * 1609.344)
        assertNull(parseDistance("", DistanceUnit.KM))
        assertNull(parseDistance("-3", DistanceUnit.KM))
        assertNull(parseDistance("abc", DistanceUnit.KM))
    }

    @Test
    fun minorDigitsFollowIso4217() {
        assertEquals(listOf(2, 0, 3), listOf(minorDigits("USD"), minorDigits("JPY"), minorDigits("KWD")))
        assertEquals(2, minorDigits("not-a-code"))
    }

    @Test
    fun moneyFromMinorUnits() {
        assertEquals("US$12.50", formatMoney(1250, "USD"))
        assertEquals("$1,234,567.89", formatMoney(123_456_789, "CAD"))
        assertEquals("£0.05", formatMoney(5, "GBP"))
        assertEquals("JP¥1,250", formatMoney(1250, "JPY"))
        assertEquals("KWD 1.250", formatMoney(1250, "KWD"))
        assertEquals("-US$12.50", formatMoney(-1250, "USD"))
        assertEquals("-JP¥1,250", formatMoney(-1250, "JPY"))
        assertEquals(NOT_AVAILABLE, formatMoney(null, "USD"))
    }

    @Test
    fun moneyFields() {
        assertEquals("12.50", moneyInput(1250, "USD"))
        assertEquals("1250", moneyInput(1250, "JPY"))
        assertEquals("1.250", moneyInput(1250, "KWD"))
        assertEquals("0.05", moneyInput(5, "USD"))
        assertEquals(1250L, parseMoney("12.50", "USD"))
        assertEquals(1250L, parseMoney("12,5", "USD"))
        assertEquals(1200L, parseMoney("12", "USD"))
        assertEquals(1250L, parseMoney("1250", "JPY"))
        assertEquals(0L, parseMoney("  ", "USD"))
        assertEquals(1251L, parseMoney("12.505", "USD"))
        assertEquals(-1250L, parseMoney("-12.505", "USD")) // Math.round: halves toward +infinity
        assertNull(parseMoney("12.5.0", "USD"))
        assertNull(parseMoney("abc", "USD"))
    }

    @Test
    fun clockTimeInTheInstanceZone() {
        val at = 1_762_535_100_000L // 2025-11-07T17:05:00Z
        assertEquals("17:05", formatClock(at, "UTC"))
        assertEquals("17:05", formatClock(at, "Europe/London"))
        assertEquals("12:05", formatClock(at, "America/Toronto"))
        assertEquals("5:05 PM", formatClock(at, "UTC", TimeFormat.H12))
        assertEquals("12:05 PM", formatClock(at, "America/Toronto", TimeFormat.H12))
        assertEquals("12:00 AM", formatClock(1_762_473_600_000L, "UTC", TimeFormat.H12))
        // an unknown zone falls back to UTC instead of failing
        assertEquals("17:05", formatClock(at, "Not/AZone"))
    }

    @Test
    fun theDriversDay() {
        val lateEvening = 1_762_563_600_000L // 2025-11-08T01:00:00Z
        assertEquals(LocalDate(2025, 11, 8), dayOf(lateEvening, "UTC"))
        assertEquals(LocalDate(2025, 11, 7), dayOf(lateEvening, "America/Vancouver"))
    }

    @Test
    fun daysInTheCountrysOrder() {
        val day = LocalDate(2026, 11, 7)
        assertEquals("Nov 7, 2026", formatDay(day, "US"))
        assertEquals("Nov 7, 2026", formatDay(day, "CA"))
        assertEquals("7 Nov 2026", formatDay(day, "GB"))
    }

    @Test
    fun durations() {
        assertEquals("in progress", formatDuration(0, null))
        assertEquals("0h 00m", formatDuration(0, 29_999))
        assertEquals("0h 01m", formatDuration(0, 30_000))
        assertEquals("1h 05m", formatDuration(0, 65 * 60_000L))
        assertEquals("0h 00m", formatDuration(60_000, 0))
    }

    @Test
    fun totalsCaptionSaysWhoCalculated() {
        assertEquals("Totals will appear once it is sent to the server", totalsCaption(null, CalcSource.PHONE))
        assertEquals("Confirmed by server", totalsCaption(1000, CalcSource.SERVER))
        assertEquals("Calculated on phone", totalsCaption(1000, CalcSource.PHONE))
    }
}
