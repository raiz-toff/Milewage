package app.milewage.phone.logic

import app.milewage.phone.support.ALLOWED
import app.milewage.tracking.TrackingController.DetectionResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The ladder (the Expo app's permissions and permissions.android tests, on Android's own rules). */
class PermissionsTest {
    private val nothing = PermissionFacts(
        sdk = 34,
        locationSwitch = true,
        precise = Runtime(granted = false),
        approximateOnly = false,
        background = Runtime(granted = false),
        notificationsPermission = Runtime(granted = false),
        notificationsOn = false,
        batteryExempt = false,
    )
    private val all = nothing.copy(
        precise = Runtime(true),
        background = Runtime(true),
        notificationsPermission = Runtime(true),
        notificationsOn = true,
        batteryExempt = true,
    )

    private fun step(f: PermissionFacts, id: PermStepId) = PermissionLadder.steps(f).single { it.id == id }

    @Test
    fun `the order - the switch, location, then all the time, notifications, battery`() {
        assertEquals(
            listOf(PermStepId.LOCATION_SWITCH, PermStepId.LOCATION, PermStepId.ALL_THE_TIME, PermStepId.NOTIFICATIONS, PermStepId.BATTERY),
            PermissionLadder.steps(nothing).map { it.id },
        )
        assertEquals(PermStepId.LOCATION, PermissionLadder.next(PermissionLadder.steps(nothing))?.id)
        assertNull(PermissionLadder.next(PermissionLadder.steps(all)))
        assertEquals(RecordMode.FULL, PermissionLadder.mode(all))
    }

    @Test
    fun `never asks for all the time before foreground location is granted`() {
        val s = step(nothing, PermStepId.ALL_THE_TIME)
        assertEquals(PermState.WAITING, s.state)
        assertEquals(PermAction.NONE, s.action)
        // Granted foreground: now it may be asked, on its own (Android opens its settings page from 11).
        assertEquals(PermAction.REQUEST, step(nothing.copy(precise = Runtime(true)), PermStepId.ALL_THE_TIME).action)
    }

    @Test
    fun `asked before and Android shows no prompt any more - blocked, the app's settings page`() {
        val blocked = nothing.copy(precise = Runtime(granted = false, asked = true, rationale = false))
        assertEquals(PermState.BLOCKED, step(blocked, PermStepId.LOCATION).state)
        assertEquals(PermAction.APP_SETTINGS, step(blocked, PermStepId.LOCATION).action)
        // Refused once: Android still asks (rationale), so the prompt again.
        val once = nothing.copy(precise = Runtime(granted = false, asked = true, rationale = true))
        assertEquals(PermAction.REQUEST, step(once, PermStepId.LOCATION).action)
        val bgBlocked = all.copy(background = Runtime(false, asked = true, rationale = false))
        assertEquals(PermAction.APP_SETTINGS, step(bgBlocked, PermStepId.ALL_THE_TIME).action)
    }

    @Test
    fun `approximate only is not enough - asking for precise again`() {
        val approx = nothing.copy(approximateOnly = true)
        assertEquals(PermState.APPROXIMATE, step(approx, PermStepId.LOCATION).state)
        assertEquals(PermAction.REQUEST, step(approx, PermStepId.LOCATION).action)
        assertEquals(RecordMode.NONE, PermissionLadder.mode(approx))
    }

    @Test
    fun `while in use only - shifts still record, all the time is recommended`() {
        val wiu = all.copy(background = Runtime(false))
        assertEquals(RecordMode.WHILE_IN_USE, PermissionLadder.mode(wiu))
        assertEquals(false, step(wiu, PermStepId.ALL_THE_TIME).required)
        assertEquals(PermStepId.ALL_THE_TIME, PermissionLadder.next(PermissionLadder.steps(wiu))?.id)
    }

    @Test
    fun `the Location switch off means none, even with every permission, and its step opens the switch`() {
        val off = all.copy(locationSwitch = false)
        assertEquals(RecordMode.NONE, PermissionLadder.mode(off))
        assertEquals(PermAction.LOCATION_SETTINGS, step(off, PermStepId.LOCATION_SWITCH).action)
        assertEquals(PermStepId.LOCATION_SWITCH, PermissionLadder.next(PermissionLadder.steps(off))?.id)
    }

    @Test
    fun `older Android versions grant the newer permissions implicitly`() {
        val android9 = nothing.copy(sdk = 28, precise = Runtime(true), notificationsOn = true)
        assertTrue(PermissionLadder.steps(android9).none { it.id == PermStepId.ALL_THE_TIME })
        assertEquals(RecordMode.FULL, PermissionLadder.mode(android9))
        // Before 13 notifications have no prompt: switched off, the settings page.
        assertEquals(PermAction.NOTIFICATION_SETTINGS, step(android9.copy(notificationsOn = false), PermStepId.NOTIFICATIONS).action)
    }

    @Test
    fun `notifications - the prompt from 13, settings once blocked or switched off`() {
        assertEquals(PermAction.REQUEST, step(nothing, PermStepId.NOTIFICATIONS).action)
        val blocked = nothing.copy(notificationsPermission = Runtime(false, asked = true, rationale = false))
        assertEquals(PermAction.NOTIFICATION_SETTINGS, step(blocked, PermStepId.NOTIFICATIONS).action)
        val switchedOff = all.copy(notificationsOn = false)
        assertEquals(PermAction.NOTIFICATION_SETTINGS, step(switchedOff, PermStepId.NOTIFICATIONS).action)
    }

    @Test
    fun `battery - the exemptions list (no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS), Samsung's own advice`() {
        assertEquals(PermAction.BATTERY_LIST, step(nothing, PermStepId.BATTERY).action)
        assertEquals(BatteryAdvice.SAMSUNG, PermissionLadder.battery("samsung"))
        assertEquals(BatteryAdvice.OTHER, PermissionLadder.battery("Google"))
    }

    @Test
    fun `local network only when Android 17 asks for it`() {
        assertTrue(PermissionLadder.steps(all).none { it.id == PermStepId.LOCAL_NETWORK })
        val needs = all.copy(localNetworkNeeded = true, localNetwork = Runtime(false))
        assertEquals(PermAction.REQUEST, step(needs, PermStepId.LOCAL_NETWORK).action)
    }

    @Test
    fun `the drive prompt's refusals name the real cause`() {
        assertEquals(DetectionOutcome.ON, DetectionOutcome.of(DetectionResult.ON, true, true))
        assertEquals(DetectionOutcome.LOCATION_OFF, DetectionOutcome.of(DetectionResult.NEEDS_BACKGROUND_LOCATION, false, true))
        assertEquals(DetectionOutcome.NO_LOCATION, DetectionOutcome.of(DetectionResult.NEEDS_BACKGROUND_LOCATION, true, false))
        assertEquals(DetectionOutcome.NEEDS_ALL_THE_TIME, DetectionOutcome.of(DetectionResult.NEEDS_BACKGROUND_LOCATION, true, true))
        assertEquals(DetectionOutcome.NOT_ALLOWED, DetectionOutcome.of(DetectionResult.NOT_ALLOWED, true, true))
        // Every refusal a driver can fix has its way forward.
        listOf(DetectionOutcome.LOCATION_OFF, DetectionOutcome.NO_LOCATION, DetectionOutcome.NEEDS_ALL_THE_TIME, DetectionOutcome.NOT_ALLOWED)
            .forEach { assertTrue(it.fix != null, "$it") }
        assertEquals(true, ALLOWED.canDetect)
    }
}
