package app.milewage.phone.model

import app.milewage.core.api.DiagnosticsLevel
import app.milewage.core.api.DiagnosticsSettings
import app.milewage.core.api.DistanceUnit as ApiUnit
import app.milewage.core.api.MileageRate
import app.milewage.core.api.Modules
import app.milewage.core.api.OwnMileageRate
import app.milewage.core.api.Settings
import app.milewage.core.format.DistanceUnit
import app.milewage.core.format.TimeFormat
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.pairing.PairingStatus
import app.milewage.phone.platform.PairLinkInbox
import app.milewage.phone.support.NOW
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FormatsTest {
    private val ca = Formats(DisplaySettings(DistanceUnit.KM, "CAD", "America/Toronto", TimeFormat.H24, "CA"))
    private val gb = Formats(DisplaySettings(DistanceUnit.MI, "GBP", "Europe/London", TimeFormat.H12, "GB"))

    @Test
    fun `numbers in the driver's unit, currency, zone and clock`() {
        assertEquals("12.3 km", ca.distance(12_345))
        assertEquals("12.3", ca.distanceNumber(12_345))
        assertEquals("—", ca.distance(null))
        assertEquals("7.7 mi", gb.distance(12_345))
        assertEquals("$29.50", ca.money(2_950))
        assertEquals("£29.50", gb.money(2_950))
        assertEquals("not available", ca.money(null))
        assertEquals("09:00", ca.clock(NOW)) // 14:00 UTC is 09:00 in Toronto
        assertEquals("2:00 PM", gb.clock(NOW))
        assertEquals("09:00–10:30", ca.range(NOW, NOW + 90 * 60_000))
        assertEquals("1h 30m", ca.duration(NOW, NOW + 90 * 60_000))
    }

    @Test
    fun `days in the country's order`() {
        val d = LocalDate.parse("2026-11-09")
        assertEquals("Mon, Nov 9", ca.shortDay(d))
        assertEquals("Mon, 9 Nov", gb.shortDay(d))
        assertEquals("Monday, Nov 9, 2026", ca.longDay(d))
        assertEquals("Monday, 9 Nov 2026", gb.longDay(d))
        assertEquals(LocalDate.parse("2026-11-10"), ca.dayOf(NOW))
    }

    @Test
    fun `odometer readings in whole units with thousands commas, the elapsed clock`() {
        assertEquals("45,210 km", ca.odometer(45_210_000))
        assertEquals("28,092 mi", gb.odometer(45_210_000))
        assertEquals("—", ca.odometer(null))
        assertEquals("0:00:00", Formats.elapsed(0))
        assertEquals("1:04:09", Formats.elapsed((3600 + 4 * 60 + 9) * 1000L + 999))
        assertEquals("0:00:00", Formats.elapsed(-5_000))
    }
}

class DisplaySettingsTest {
    private val base = Settings(
        country = "US",
        distanceUnit = ApiUnit.MI,
        currency = "USD",
        timezone = "America/Chicago",
        stopsEnabled = true,
        engineVersion = 4,
        diagnostics = DiagnosticsSettings(DiagnosticsLevel.OFF),
        modules = Modules(tracking = true, stops = true),
        weekStart = 0,
        timeFormat = "12h",
        defaultVehicleId = 4,
    )

    @Test
    fun `read from the server's settings, unpaired is the plainest reading`() {
        val s = DisplaySettings.of(base)
        assertEquals(DistanceUnit.MI, s.unit)
        assertEquals(TimeFormat.H12, s.timeFormat)
        assertEquals(0, s.weekStart)
        assertTrue(s.stops)
        assertTrue(s.tracking)
        assertEquals(4L, s.defaultVehicleId)
        assertFalse(s.yourRate)
        assertEquals(DisplaySettings(), DisplaySettings.of(null))
    }

    @Test
    fun `the driver's own rate is labelled theirs exactly where the phone uses it`() {
        val own = OwnMileageRate(70.0, ApiUnit.MI)
        assertTrue(DisplaySettings.of(base.copy(ownMileageRate = own, mileageRate = MileageRate.YOURS)).yourRate)
        assertTrue(DisplaySettings.of(base.copy(ownMileageRate = own, mileageRate = null)).yourRate)
        assertFalse(DisplaySettings.of(base.copy(ownMileageRate = own, mileageRate = MileageRate.OFFICIAL)).yourRate)
    }

    @Test
    fun `stops need both the module and the setting`() {
        assertFalse(DisplaySettings.of(base.copy(stopsEnabled = false)).stops)
        assertFalse(DisplaySettings.of(base.copy(modules = Modules(tracking = true, stops = false))).stops)
    }
}

class PairLinkInboxTest {
    private val token = "mwp_" + "a".repeat(43)
    private val away = "https://box.tail1234.ts.net"
    private val link = "milewage://pair?v=1&u=${PairingLinks.encodeUriComponent(away)}&t=$token"

    @Test
    fun `a pairing link is decided once, an already paired phone says so instead of switching servers`() = runTest {
        var status = PairingStatus.UNPAIRED
        val inbox = PairLinkInbox(status = { status })
        inbox.receive(link)
        val first = assertIs<LinkDecision.Ask>(inbox.pending.value)
        assertEquals(away, first.link.baseUrl)
        inbox.consume()
        inbox.receive(link) // the start intent and a new-intent event deliver the same link twice
        assertNull(inbox.pending.value)
        status = PairingStatus.PAIRED
        inbox.receive("$link&h=${PairingLinks.encodeUriComponent("http://192.168.1.20:8080")}")
        assertIs<LinkDecision.AlreadyConnected>(inbox.pending.value)
        inbox.consume()
        inbox.receive("milewage://pair?v=1&t=nonsense")
        assertIs<LinkDecision.NotAPairingCode>(inbox.pending.value)
    }

    @Test
    fun `other links are ignored, the https page link is taken once`() = runTest {
        val inbox = PairLinkInbox(status = { PairingStatus.UNPAIRED })
        inbox.receive("https://example.com/somewhere")
        assertNull(inbox.pending.value)
        inbox.receive(null)
        assertNull(inbox.pending.value)
        val page = "$away/pair#v=1&t=$token"
        inbox.receive(page)
        assertEquals(away, assertIs<LinkDecision.Ask>(inbox.pending.value).link.baseUrl)
        inbox.consume()
        inbox.receive(page)
        assertNull(inbox.pending.value)
    }
}
