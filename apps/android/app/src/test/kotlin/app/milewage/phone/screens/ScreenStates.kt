package app.milewage.phone.screens

import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ServerFlag
import app.milewage.core.sync.Progress
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.core.tracking.TrackingStatus
import app.milewage.data.ShiftListItem
import app.milewage.engine.Flag
import app.milewage.engine.FlagCode
import app.milewage.phone.logic.Banners
import app.milewage.phone.logic.Overwrites
import app.milewage.phone.logic.Setup
import app.milewage.phone.logic.ShiftFlags
import app.milewage.phone.logic.ShiftGroups
import app.milewage.phone.logic.TrackingLines
import app.milewage.phone.logic.VehicleChoice
import app.milewage.phone.logic.VehicleSource
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.HOUR
import app.milewage.phone.support.NOW
import app.milewage.phone.support.SUMMARY
import app.milewage.phone.support.VAN
import app.milewage.phone.support.detail
import app.milewage.phone.support.recording
import app.milewage.phone.support.runningView
import app.milewage.phone.support.sendStatus
import app.milewage.phone.support.shift
import app.milewage.phone.ui.detail.DetailState
import app.milewage.phone.ui.home.HomeState
import app.milewage.phone.ui.shifts.ShiftsState
import kotlinx.datetime.LocalDate

/** The states each screen is drawn in for the tests and the screenshots (decided by the real logic). */
object ScreenStates {
    val settings = DisplaySettings(currency = "CAD", timezone = "UTC", country = "CA", stops = true)

    private val fresh = ALLOWED.copy(backgroundLocation = false, notifications = false, ignoringBatteryOptimizations = false)

    /** First days: setup unfinished, two vehicles, something waiting to be sent. */
    val homeIdle = HomeState(
        ready = true,
        settings = settings,
        summary = SUMMARY,
        banner = Banners.of(sendStatus(StatusColor.YELLOW, 1, 342, NOW - 2 * HOUR, StatusMessage.OFFLINE), NOW),
        vehicles = VehicleChoice(listOf(CIVIC, VAN), CIVIC.id, VehicleSource.SERVER),
        setup = Setup.of(fresh),
    )

    /** Everything set up and sent, one vehicle, the driver's own rate. */
    val homeAllSent = homeIdle.copy(
        settings = settings.copy(yourRate = true),
        banner = Banners.of(sendStatus(), NOW),
        vehicles = VehicleChoice(listOf(CIVIC), CIVIC.id, VehicleSource.SERVER),
        setup = Setup.of(ALLOWED),
    )

    /** The server removed this phone; the vehicles are the kept copy; a reminder is due. */
    val homeRevoked = homeAllSent.copy(
        pairing = PairingStatus.REVOKED,
        banner = Banners.of(sendStatus(StatusColor.RED, 3, 1_204, NOW - 4 * 86_400_000L, StatusMessage.REVOKED), NOW),
        vehicles = VehicleChoice(listOf(CIVIC), CIVIC.id, VehicleSource.KEPT),
    )

    /** No vehicle could be loaded. */
    val homeNoVehicles = homeAllSent.copy(vehicles = VehicleChoice(emptyList(), null, VehicleSource.KEPT), summary = null)

    /** Sending in progress. */
    val homeSending = homeAllSent.copy(
        banner = Banners.of(sendStatus(StatusColor.YELLOW, 2, 680, NOW - HOUR, progress = Progress(Progress.Phase.RUNNING, 240, 680, 0, 2)), NOW),
    )

    private val run = runningView()

    val running = HomeState(
        ready = true,
        settings = settings,
        summary = SUMMARY,
        running = run,
        trackingLine = TrackingLines.of(run.shift, recording("run"), ALLOWED, true, true),
        banner = Banners.of(sendStatus(StatusColor.YELLOW, 1, 40, NOW), NOW),
        vehicles = VehicleChoice(listOf(CIVIC), CIVIC.id, VehicleSource.SERVER),
        setup = Setup.of(ALLOWED),
    )

    /** Stopped at a light: the low-power watch. */
    val runningLow = running.copy(trackingLine = TrackingLines.of(run.shift, recording("run", app.milewage.core.tracking.PowerLevel.LOW), ALLOWED, true, true))

    /** Not recording after a restart, offline, and another shift holds the server. */
    val runningLost = running.copy(
        running = runningView(serverId = null, other = true, cents = null),
        trackingLine = TrackingLines.of(run.shift, TrackingStatus(), ALLOWED, true, true),
        banner = Banners.of(sendStatus(StatusColor.YELLOW, 2, 1_870, NOW - 3 * HOUR, StatusMessage.OFFLINE), NOW),
    )

    /** Location switched off mid-shift. */
    val runningLocationOff = running.copy(trackingLine = TrackingLines.of(run.shift, recording("run"), ALLOWED.copy(locationEnabled = false), true, true))

    private fun item(id: String, daysAgo: Int, hour: Int, m: Long?, send: SendState, calc: CalcSource = CalcSource.PHONE, flags: List<ServerFlag> = emptyList()): ShiftListItem {
        val start = NOW - daysAgo * 86_400_000L - (14 - hour) * HOUR
        val date = LocalDate.parse("2026-11-10").let { LocalDate.fromEpochDays(it.toEpochDays() - daysAgo) }.toString()
        val s = shift(id, startedAt = start, endedAt = start + 4 * HOUR + 30 * 60_000, totalM = m, localDate = date, sendState = send, calc = calc).copy(serverFlags = flags)
        return ShiftListItem(s, ShiftMarker.of(s), CIVIC)
    }

    val shifts = ShiftsState(
        loaded = true,
        settings = settings,
        groups = ShiftGroups.of(
            listOf(
                ShiftListItem(shift("run", startedAt = NOW - HOUR, endedAt = null, totalM = null), ShiftMarker.ON_PHONE_ONLY, CIVIC),
                item("a", 1, 11, 77_000, SendState.SENT, CalcSource.SERVER),
                item("b", 2, 16, 114_000, SendState.SENT, CalcSource.SERVER, listOf(ServerFlag("gap_large", "warn"))),
                item("c", 4, 9, 98_000, SendState.ON_PHONE_ONLY),
                item("d", 5, 10, 45_000, SendState.NEEDS_ATTENTION),
                item("e", 9, 11, null, SendState.ON_PHONE_ONLY),
            ),
            LocalDate.parse("2026-11-10"),
            1,
        ),
    )

    val shiftsEmpty = ShiftsState(loaded = true, settings = settings)

    private val full = detail().let { d ->
        val s = d.shift.copy(phoneFlags = listOf(Flag(FlagCode.GAP_DROPPED), Flag(FlagCode.MANUAL_TRIP_PRESENT)), notes = "Rain all afternoon.")
        d.copy(
            shift = s,
            overwrites = listOf(OverwriteEntry(5, NOW, "shift", "s1", OverwriteReason.RECON_DIFF, """{"total_m":12000}""", """{"total_m":12345,"reasons":["late_points","edited_on_web"]}""")),
        )
    }

    val detailFull = DetailState(
        loaded = true,
        settings = settings,
        detail = full,
        flags = ShiftFlags.of(full.shift),
        overwrites = full.overwrites.map(Overwrites::of),
    )

    private val sent = detail(shift(sendState = SendState.SENT, calc = CalcSource.SERVER, segmenter = app.milewage.core.api.Segmenter.WHOLE_SHIFT), stops = emptyList(), odometer = emptyList()).let {
        it.copy(shift = it.shift.copy(serverDeductionKnown = true, serverDeductionCents = 860))
    }

    val detailSent = DetailState(loaded = true, settings = settings.copy(stops = false), detail = sent, flags = ShiftFlags.of(sent.shift))

    val detailGone = DetailState(loaded = true, settings = settings)
}
