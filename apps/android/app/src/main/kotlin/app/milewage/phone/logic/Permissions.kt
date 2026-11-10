package app.milewage.phone.logic

import app.milewage.tracking.TrackingController

/*
 * The permissions ladder (09 section 5.3, 24 section 4.2, Android's guidance on location:
 * developer.android.com/develop/sensors-and-location/location/permissions). Plain Kotlin over what
 * the phone reports ([PermissionFacts]); the screen asks Android and opens the settings pages.
 * Order: the Location switch (the real cause comes first), precise location while in use, then
 * "Allow all the time" asked separately and only after it, notifications, battery, local network.
 */

/** One runtime permission as Android reports it, plus whether this app asked before. */
data class Runtime(
    val granted: Boolean,
    /** This app showed the prompt before (Android cannot say; kept in the app's preferences). */
    val asked: Boolean = false,
    /** `shouldShowRequestPermissionRationale`: refused once, the prompt can still be shown. */
    val rationale: Boolean = false,
) {
    /** Android will not show the prompt again: only the app's settings page can change it. */
    val blocked: Boolean get() = !granted && asked && !rationale
}

/** What the phone allows now. Read on every resume: settings change without a prompt. */
data class PermissionFacts(
    val sdk: Int,
    val locationSwitch: Boolean,
    /** ACCESS_FINE_LOCATION. */
    val precise: Runtime,
    /** ACCESS_COARSE_LOCATION without fine: Android 12+ "Approximate". */
    val approximateOnly: Boolean,
    /** ACCESS_BACKGROUND_LOCATION (Android 10+). */
    val background: Runtime,
    /** POST_NOTIFICATIONS (Android 13+). */
    val notificationsPermission: Runtime,
    /** The app's notifications are on (also below Android 13, where there is no permission). */
    val notificationsOn: Boolean,
    val batteryExempt: Boolean,
    /** Android 17 at targetSdk 37 only (ACCESS_LOCAL_NETWORK). */
    val localNetworkNeeded: Boolean = false,
    val localNetwork: Runtime = Runtime(granted = true),
    /** The phone's maker (Build.MANUFACTURER), for the battery advice. */
    val maker: String = "",
)

enum class PermStepId { LOCATION_SWITCH, LOCATION, ALL_THE_TIME, NOTIFICATIONS, BATTERY, LOCAL_NETWORK }

enum class PermState {
    DONE,

    /** Not allowed yet. */
    TODO,

    /** Android 12+ "Approximate": not enough for GPS. */
    APPROXIMATE,

    /** Refused for good: only the settings page can change it. */
    BLOCKED,

    /** Needs an earlier step first ("Allow all the time" after location). */
    WAITING,
}

/** What the step's one button does. */
enum class PermAction {
    NONE,

    /** Show Android's prompt. */
    REQUEST,

    /** This app's page in the phone's settings. */
    APP_SETTINGS,

    /** The phone's Location switch. */
    LOCATION_SETTINGS,

    /** The phone's list of battery optimisation exemptions (no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: manifest policy). */
    BATTERY_LIST,

    /** This app's notification settings. */
    NOTIFICATION_SETTINGS,
}

data class PermStep(val id: PermStepId, val state: PermState, val action: PermAction, val required: Boolean)

/** Recording a shift with what is allowed: everything, with the screen on only at worst, or nothing. */
enum class RecordMode { FULL, WHILE_IN_USE, NONE }

/** The battery advice: Samsung's own menus, or the general one. */
enum class BatteryAdvice { SAMSUNG, OTHER }

object PermissionLadder {
    /** Android 10: ACCESS_BACKGROUND_LOCATION exists; below it, location is "all the time". */
    const val Q = 29

    /** Android 13: POST_NOTIFICATIONS. */
    const val TIRAMISU = 33

    fun steps(f: PermissionFacts): List<PermStep> = buildList {
        add(
            PermStep(
                PermStepId.LOCATION_SWITCH,
                if (f.locationSwitch) PermState.DONE else PermState.TODO,
                if (f.locationSwitch) PermAction.NONE else PermAction.LOCATION_SETTINGS,
                required = true,
            ),
        )
        add(location(f))
        if (f.sdk >= Q) add(allTheTime(f))
        add(notifications(f))
        add(
            PermStep(
                PermStepId.BATTERY,
                if (f.batteryExempt) PermState.DONE else PermState.TODO,
                if (f.batteryExempt) PermAction.NONE else PermAction.BATTERY_LIST,
                required = false,
            ),
        )
        if (f.localNetworkNeeded) add(runtime(PermStepId.LOCAL_NETWORK, f.localNetwork, required = false))
    }

    private fun location(f: PermissionFacts): PermStep {
        val p = f.precise
        return when {
            p.granted -> PermStep(PermStepId.LOCATION, PermState.DONE, PermAction.NONE, true)
            p.blocked -> PermStep(PermStepId.LOCATION, PermState.BLOCKED, PermAction.APP_SETTINGS, true)
            // Asking for fine again shows Android 12's "change to precise" prompt.
            f.approximateOnly -> PermStep(PermStepId.LOCATION, PermState.APPROXIMATE, PermAction.REQUEST, true)
            else -> PermStep(PermStepId.LOCATION, PermState.TODO, PermAction.REQUEST, true)
        }
    }

    /**
     * Android's guidance: ask for background location only after foreground location is granted,
     * and on its own. From Android 11 the request opens the location page of the app's settings,
     * where the driver picks the option (its label is the system's own,
     * `PackageManager.getBackgroundPermissionOptionLabel`).
     */
    private fun allTheTime(f: PermissionFacts): PermStep {
        if (!f.precise.granted) {
            val state = if (f.background.granted) PermState.DONE else PermState.WAITING
            return PermStep(PermStepId.ALL_THE_TIME, state, PermAction.NONE, false)
        }
        return runtime(PermStepId.ALL_THE_TIME, f.background, required = false)
    }

    private fun notifications(f: PermissionFacts): PermStep = when {
        f.notificationsOn -> PermStep(PermStepId.NOTIFICATIONS, PermState.DONE, PermAction.NONE, false)
        f.sdk >= TIRAMISU && !f.notificationsPermission.granted && !f.notificationsPermission.blocked ->
            PermStep(PermStepId.NOTIFICATIONS, PermState.TODO, PermAction.REQUEST, false)
        f.sdk >= TIRAMISU && f.notificationsPermission.blocked ->
            PermStep(PermStepId.NOTIFICATIONS, PermState.BLOCKED, PermAction.NOTIFICATION_SETTINGS, false)
        // Allowed, but switched off in the phone's settings (or before Android 13, where that is the only switch).
        else -> PermStep(PermStepId.NOTIFICATIONS, PermState.TODO, PermAction.NOTIFICATION_SETTINGS, false)
    }

    private fun runtime(id: PermStepId, r: Runtime, required: Boolean): PermStep = when {
        r.granted -> PermStep(id, PermState.DONE, PermAction.NONE, required)
        r.blocked -> PermStep(id, PermState.BLOCKED, PermAction.APP_SETTINGS, required)
        else -> PermStep(id, PermState.TODO, PermAction.REQUEST, required)
    }

    fun mode(f: PermissionFacts): RecordMode = when {
        !f.locationSwitch || !f.precise.granted -> RecordMode.NONE
        f.sdk < Q || f.background.granted -> RecordMode.FULL
        else -> RecordMode.WHILE_IN_USE
    }

    /** The first step left to do, for "Next step" (null: everything is allowed). */
    fun next(steps: List<PermStep>): PermStep? = steps.firstOrNull { it.state != PermState.DONE && it.action != PermAction.NONE }

    fun battery(maker: String): BatteryAdvice = if (maker.contains("samsung", ignoreCase = true)) BatteryAdvice.SAMSUNG else BatteryAdvice.OTHER
}

/** Settings > "Ask to start a shift when I seem to be driving": the tracker's answer in the driver's terms. */
enum class DetectionOutcome(val fix: Fix?) {
    ON(null),
    OFF(null),

    /** The Location switch is off: name the switch. */
    LOCATION_OFF(Fix.LOCATION_SETTINGS),

    /** No precise location at all. */
    NO_LOCATION(Fix.APP_SETTINGS),

    /** Location only while in use: detection runs with no app on screen. */
    NEEDS_ALL_THE_TIME(Fix.APP_SETTINGS),

    /** Android refused to start the watch from here. */
    NOT_ALLOWED(Fix.START_AGAIN),

    /** The tracker is not part of this build (never on a phone). */
    NOT_WIRED(null),
    ;

    companion object {
        fun of(r: TrackingController.DetectionResult, locationSwitch: Boolean, precise: Boolean): DetectionOutcome = when (r) {
            TrackingController.DetectionResult.ON -> ON
            TrackingController.DetectionResult.OFF -> OFF
            TrackingController.DetectionResult.NEEDS_BACKGROUND_LOCATION -> when {
                !locationSwitch -> LOCATION_OFF
                !precise -> NO_LOCATION
                else -> NEEDS_ALL_THE_TIME
            }
            TrackingController.DetectionResult.NOT_ALLOWED -> NOT_ALLOWED
            TrackingController.DetectionResult.NOT_WIRED -> NOT_WIRED
        }
    }
}
