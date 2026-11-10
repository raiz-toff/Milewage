package app.milewage.phone.logic

import app.milewage.core.pairing.HaltReason
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.sync.Progress
import app.milewage.core.sync.Reminder
import app.milewage.core.sync.SendStatus
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.core.sync.SyncStatus
import app.milewage.core.tracking.PowerLevel
import app.milewage.core.tracking.TrackingProblem
import app.milewage.core.tracking.TrackingStatus
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.NOW
import app.milewage.phone.support.VAN
import app.milewage.phone.support.recording
import app.milewage.phone.support.runningView
import app.milewage.phone.support.sendStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StartGateTest {
    private val one = VehicleChoice(listOf(CIVIC), CIVIC.id, VehicleSource.SERVER)

    @Test
    fun `the Location switch is named before the permission, then precise, then pairing, then a vehicle`() {
        val off = ALLOWED.copy(locationEnabled = false, preciseLocation = false)
        assertEquals(StartProblem.LOCATION_OFF, StartGate.check(off, true, PairingStatus.UNPAIRED, VehicleChoice()))
        val approx = ALLOWED.copy(preciseLocation = false, approximateOnly = true)
        assertEquals(StartProblem.APPROXIMATE_ONLY, StartGate.check(approx, true, PairingStatus.PAIRED, one))
        assertEquals(StartProblem.NO_PERMISSION, StartGate.check(ALLOWED.copy(preciseLocation = false), true, PairingStatus.PAIRED, one))
        assertEquals(StartProblem.NOT_PAIRED, StartGate.check(ALLOWED, true, PairingStatus.UNPAIRED, one))
        assertNull(StartGate.check(ALLOWED, true, PairingStatus.PAIRED, one))
    }

    @Test
    fun `a revoked phone still records (its data waits for the re-pair)`() {
        assertNull(StartGate.check(ALLOWED, true, PairingStatus.REVOKED, one))
    }

    @Test
    fun `no vehicle, not loaded when offline or still loading, none when the server has none`() {
        assertEquals(StartProblem.VEHICLES_NOT_LOADED, StartGate.check(ALLOWED, true, PairingStatus.PAIRED, VehicleChoice(source = VehicleSource.KEPT)))
        assertEquals(StartProblem.VEHICLES_NOT_LOADED, StartGate.check(ALLOWED, true, PairingStatus.PAIRED, VehicleChoice()))
        assertEquals(StartProblem.NO_VEHICLES, StartGate.check(ALLOWED, true, PairingStatus.PAIRED, VehicleChoice(source = VehicleSource.SERVER)))
    }

    @Test
    fun `with the server's tracking module off location is not needed`() {
        assertNull(StartGate.check(ALLOWED.copy(locationEnabled = false, preciseLocation = false), false, PairingStatus.PAIRED, one))
    }

    @Test
    fun `every problem offers one way forward`() {
        StartProblem.entries.forEach { assertNotNull(it.fix, "$it has no way forward") }
    }

    @Test
    fun `the vehicle kept is the driver's pick, then the last used, then the default, then the first`() {
        val list = listOf(CIVIC, VAN)
        assertEquals(VAN.id, VehicleChoice.pick(list, VAN.id, CIVIC.id, CIVIC.id))
        assertEquals(VAN.id, VehicleChoice.pick(list, null, VAN.id, CIVIC.id))
        assertEquals(VAN.id, VehicleChoice.pick(list, 99, null, VAN.id))
        assertEquals(CIVIC.id, VehicleChoice.pick(list, null, 99, null))
        assertNull(VehicleChoice.pick(emptyList(), 3, 3, 3))
    }
}

class TrackingLinesTest {
    private val shift = runningView("run").shift

    @Test
    fun `recording, saving battery, and the screen-off warning`() {
        assertEquals(TrackingLine.RECORDING, TrackingLines.of(shift, recording("run"), ALLOWED, true, true))
        assertEquals(TrackingLine.SAVING_BATTERY, TrackingLines.of(shift, recording("run", PowerLevel.LOW), ALLOWED, true, true))
        assertEquals(TrackingLine.NO_BACKGROUND, TrackingLines.of(shift, recording("run"), ALLOWED.copy(backgroundLocation = false), true, true))
    }

    @Test
    fun `the switch and the permission come first, from the phone's own reading`() {
        assertEquals(TrackingLine.LOCATION_OFF, TrackingLines.of(shift, recording("run"), ALLOWED.copy(locationEnabled = false), true, true))
        assertEquals(TrackingLine.PERMISSION_LOST, TrackingLines.of(shift, recording("run"), ALLOWED.copy(preciseLocation = false), true, true))
        assertEquals(
            TrackingLine.LOCATION_OFF,
            TrackingLines.of(shift, recording("run").copy(problem = TrackingProblem.LOCATION_OFF), ALLOWED, true, true),
        )
        assertEquals(
            TrackingLine.NO_PROVIDER,
            TrackingLines.of(shift, recording("run").copy(problem = TrackingProblem.NO_LOCATION_PROVIDER), ALLOWED, true, true),
        )
    }

    @Test
    fun `not recording is a moment at first, then real (resume or end it)`() {
        assertEquals(TrackingLine.STARTING, TrackingLines.of(shift, TrackingStatus(), ALLOWED, true, checked = false))
        assertEquals(TrackingLine.NOT_RECORDING, TrackingLines.of(shift, TrackingStatus(), ALLOWED, true, checked = true))
        // Recording another shift is not recording this one.
        assertEquals(TrackingLine.NOT_RECORDING, TrackingLines.of(shift, recording("other"), ALLOWED, true, checked = true))
        assertEquals(Fix.RESUME_RECORDING, TrackingLine.NOT_RECORDING.fix)
    }

    @Test
    fun `the server's tracking module off says so instead of a problem`() {
        assertEquals(TrackingLine.SERVER_TRACKING_OFF, TrackingLines.of(shift, TrackingStatus(), ALLOWED.copy(locationEnabled = false), false, true))
    }

    @Test
    fun `every problem carries a fix`() {
        TrackingLine.entries.filter { it.problem }.forEach { assertNotNull(it.fix, "$it") }
    }
}

class BannersTest {
    private fun of(s: SendStatus) = Banners.of(s, NOW)

    @Test
    fun `nothing waiting is all sent, with no action`() {
        val b = of(sendStatus())
        assertEquals(BannerKind.ALL_SENT, b.kind)
        assertNull(b.kind.fix)
        assertEquals(Reminder.Level.NONE, b.reminder)
    }

    @Test
    fun `waiting and offline offer Send now, with the counts and the age`() {
        val b = of(sendStatus(StatusColor.YELLOW, 2, 340, NOW - 86_400_000L - 1, StatusMessage.OFFLINE))
        assertEquals(BannerKind.OFFLINE, b.kind)
        assertEquals(Fix.SEND_NOW, b.kind.fix)
        assertEquals(2, b.unsentShifts)
        assertEquals(340, b.unsentFixes)
        assertEquals(1, b.oldestDays)
        assertEquals(BannerKind.WAITING, of(sendStatus(StatusColor.YELLOW, 1, 10, NOW)).kind)
    }

    @Test
    fun `the most serious sentence wins, each with its one action`() {
        val cases = mapOf(
            StatusMessage.WRONG_SERVER to (BannerKind.WRONG_SERVER to Fix.CHECK_ADDRESS),
            StatusMessage.REVOKED to (BannerKind.REVOKED to Fix.PAIR),
            StatusMessage.AUTH_PROBLEM to (BannerKind.AUTH_PROBLEM to Fix.PAIR),
            StatusMessage.RESTORED to (BannerKind.RESTORED to Fix.SEND_NOW),
            StatusMessage.STORAGE_CRITICAL to (BannerKind.STORAGE_CRITICAL to Fix.STORAGE_SETTINGS),
            StatusMessage.STORAGE_LOW to (BannerKind.STORAGE_LOW to Fix.STORAGE_SETTINGS),
            StatusMessage.NEEDS_ATTENTION to (BannerKind.NEEDS_ATTENTION to Fix.OPEN_SHIFTS),
        )
        cases.forEach { (msg, expected) ->
            val b = of(sendStatus(StatusColor.RED, 1, 5, NOW, msg))
            assertEquals(expected.first, b.kind, "$msg")
            assertEquals(expected.second, b.kind.fix, "$msg")
        }
    }

    @Test
    fun `a wrong-server halt without a sentence still says it`() {
        val s = SendStatus(SyncStatus(StatusColor.RED, 0, 0, null, null, HaltReason.WRONG_SERVER), Progress())
        assertEquals(BannerKind.WRONG_SERVER, of(s).kind)
    }

    @Test
    fun `a round in progress shows its progress and Stop sending`() {
        val p = Progress(Progress.Phase.RUNNING, fixesSent = 100, fixesTotal = 340, shiftsDone = 0, shiftsTotal = 2)
        val b = of(sendStatus(StatusColor.YELLOW, 2, 340, NOW, progress = p))
        assertEquals(BannerKind.SENDING, b.kind)
        assertEquals(Fix.STOP_SENDING, b.kind.fix)
        assertEquals(p, b.progress)
    }

    @Test
    fun `the reminder line, none before 3 days, then normal, stronger from 7`() {
        val day = 86_400_000L
        assertEquals(Reminder.Level.NONE, of(sendStatus(StatusColor.YELLOW, 1, 0, NOW - 2 * day)).reminder)
        assertEquals(Reminder.Level.NORMAL, of(sendStatus(StatusColor.YELLOW, 1, 0, NOW - 3 * day)).reminder)
        assertEquals(Reminder.Level.STRONG, of(sendStatus(StatusColor.YELLOW, 1, 0, NOW - 8 * day)).reminder)
    }
}

class SetupTest {
    @Test
    fun `the checklist reads the phone's real state and hides when everything is done`() {
        assertFalse(Setup.unfinished(Setup.of(ALLOWED)))
        val fresh = ALLOWED.copy(preciseLocation = false, backgroundLocation = false, notifications = false, ignoringBatteryOptimizations = false)
        val items = Setup.of(fresh)
        assertTrue(Setup.unfinished(items))
        assertEquals(listOf(SetupStep.LOCATION, SetupStep.ALWAYS, SetupStep.NOTIFICATIONS, SetupStep.BATTERY), items.map { it.step })
        assertTrue(items.none { it.done })
        // "All the time" without precise location is not done.
        assertFalse(Setup.of(ALLOWED.copy(preciseLocation = false)).first { it.step == SetupStep.ALWAYS }.done)
        assertEquals(Fix.NOTIFICATIONS, SetupStep.NOTIFICATIONS.fix)
        assertEquals(Fix.BATTERY_SETTINGS, SetupStep.BATTERY.fix)
    }
}
