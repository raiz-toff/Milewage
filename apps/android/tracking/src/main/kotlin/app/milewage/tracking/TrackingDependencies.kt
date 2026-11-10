package app.milewage.tracking

import android.content.Context
import app.milewage.core.tracking.ActiveShiftStore
import app.milewage.core.tracking.FixStore
import app.milewage.core.tracking.InterruptionLog
import app.milewage.core.tracking.ShiftCommands
import app.milewage.core.tracking.TrackingDiagnostics
import app.milewage.core.tracking.TrackingSettingsStore
import app.milewage.core.tracking.TrackingStateStore

/**
 * What the tracking layer needs from the app. The `Application` implements
 * [TrackingDependenciesProvider] (no dependency injection framework), so the service, the
 * receivers and [TrackingController] find the same objects, and `:tracking` never depends on `:data`.
 *
 * Use [trackingDependencies] to build one with the SharedPreferences stores of this module.
 */
interface TrackingDependencies {
    /** The points table (`:data`'s Room store; `InMemoryFixStore` until it lands). */
    val fixStore: FixStore
    val activeShiftStore: ActiveShiftStore
    val settingsStore: TrackingSettingsStore
    val interruptionLog: InterruptionLog
    val stateStore: TrackingStateStore

    /** The app's shift logic, for the Start and End shift buttons on notifications. */
    val shiftCommands: ShiftCommands

    /** Counts and states only, never a coordinate. */
    val diagnostics: TrackingDiagnostics
}

/** Implemented by the `Application`. */
interface TrackingDependenciesProvider {
    val trackingDependencies: TrackingDependencies
}

/** The usual wiring: this module's SharedPreferences stores plus the app's fix store and shift commands. */
fun trackingDependencies(
    context: Context,
    fixStore: FixStore,
    shiftCommands: ShiftCommands,
    diagnostics: TrackingDiagnostics = TrackingDiagnostics.NONE,
): TrackingDependencies {
    val prefs = PrefsTrackingStores(context)
    return object : TrackingDependencies {
        override val fixStore = fixStore
        override val activeShiftStore: ActiveShiftStore = prefs.activeShift
        override val settingsStore: TrackingSettingsStore = prefs.settings
        override val interruptionLog: InterruptionLog = prefs.interruptions
        override val stateStore: TrackingStateStore = prefs.state
        override val shiftCommands = shiftCommands
        override val diagnostics = diagnostics
    }
}
