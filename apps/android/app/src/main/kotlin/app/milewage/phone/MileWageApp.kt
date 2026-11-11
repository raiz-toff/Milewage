package app.milewage.phone

import android.os.StrictMode
import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.milewage.data.MileWageData
import app.milewage.data.MileWageDataProvider
import app.milewage.data.prefs.UiPreferences
import app.milewage.phone.platform.AppNotifications
import app.milewage.tracking.TrackingDependencies
import app.milewage.tracking.TrackingDependenciesProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The application: makes the one [AppGraph] (the service locator) and wires the process to it.
 *
 * - The tracking module finds its dependencies here ([TrackingDependenciesProvider]); the send
 *   worker finds `MileWageData` ([MileWageDataProvider]).
 * - `onCreate`: the reminder channel, then `MileWageData.start` (recovery of a shift a kill cut
 *   short, `app.start`, the sending loop, the hourly worker) and the shift notification's details.
 * - Each time the app comes to the foreground: `ensureRunning()` (a shift that should record and
 *   does not is started again) and `kick()` (a send round). The network coming back
 *   kicks too (`MileWageData.create` registers that).
 * - A crash is recorded in the diagnostics ring before the process dies (never a coordinate).
 */
class MileWageApp : Application(), TrackingDependenciesProvider, MileWageDataProvider {
    /** Process-wide: lives as long as the process; work that must outlive a screen runs here. */
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val graph: AppGraph by lazy { AppGraph(this, scope) }

    val uiPreferences: UiPreferences get() = graph.uiPreferences

    override val trackingDependencies: TrackingDependencies get() = graph.trackingDependencies

    override val mileWageData: MileWageData get() = graph.data

    override fun onCreate() {
        super.onCreate()
        // Debug builds only: log any disk or network access on the main thread (it makes the app
        // stutter), so one that slips in shows up in logcat as "StrictMode" before a driver feels it.
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
        }
        AppNotifications.createChannels(this)
        recordCrashes()
        graph.start()
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    scope.launch {
                        runCatching { graph.tracking.ensureRunning() }
                        graph.data.kick()
                    }
                }
            },
        )
    }

    private fun recordCrashes() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            // At most a second: the ring is a local table; the crash goes to the server with the next window.
            runCatching { runBlocking { withTimeoutOrNull(1_000) { graph.data.diagnostics.recordCrash(error, fatal = true) } } }
            previous?.uncaughtException(thread, error)
        }
    }
}
