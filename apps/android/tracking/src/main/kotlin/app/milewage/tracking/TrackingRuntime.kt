package app.milewage.tracking

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import app.milewage.core.tracking.LocationPlan
import app.milewage.core.tracking.TrackingCore
import app.milewage.core.tracking.TrackingEffect
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** The service side of the effects: only the running service can hold location requests. */
internal interface ServiceSink {
    fun apply(effect: TrackingEffect)
}

/**
 * One per process: the [TrackingCore] and a single queue that runs every command against it in
 * order (fixes, sensor triggers, ticks, the controller's calls, notification buttons) and applies
 * the effects on the main thread. Notification effects are applied here; location requests and
 * the ongoing notification by the service ([ServiceSink]), which is started when needed.
 */
internal class TrackingRuntime private constructor(context: Context, val deps: TrackingDependencies) {
    val app: Context = context.applicationContext
    val capabilities = readCapabilities(app)
    val core = TrackingCore(
        deps.fixStore, deps.activeShiftStore, deps.settingsStore, deps.interruptionLog, deps.stateStore,
        deps.diagnostics, capabilities,
    )
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Volatile var service: ServiceSink? = null

    private class Command(val run: suspend TrackingCore.() -> List<TrackingEffect>, val done: CompletableDeferred<Unit>?)

    private val queue = Channel<Command>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (c in queue) {
                val effects = try {
                    c.run(core)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // The core catches storage errors itself; anything else is a bug, never a crash.
                    deps.diagnostics.record("core_error", mapOf("type" to (e::class.simpleName ?: "Exception")))
                    emptyList()
                }
                apply(effects)
                c.done?.complete(Unit)
            }
        }
    }

    /** Runs [cmd] in turn and applies its effects; does not wait. */
    fun submit(cmd: suspend TrackingCore.() -> List<TrackingEffect>) {
        queue.trySend(Command(cmd, null))
    }

    /** Runs [cmd] in turn, applies its effects, and returns when that is done. */
    suspend fun call(cmd: suspend TrackingCore.() -> List<TrackingEffect>) {
        val done = CompletableDeferred<Unit>()
        queue.send(Command(cmd, done))
        done.await()
    }

    private fun apply(effects: List<TrackingEffect>) {
        for (e in effects) {
            when (e) {
                is TrackingEffect.PostNudge ->
                    TrackingNotifications.postNudge(app, System.currentTimeMillis() - e.stillSinceMs)
                TrackingEffect.CancelNudge -> TrackingNotifications.cancel(app, TrackingNotifications.ID_NUDGE)
                else -> {
                    val s = service
                    if (s != null) {
                        s.apply(e)
                    } else if (needsService(e)) {
                        // A command (an alarm, a button) found work for a service that is not running.
                        startService(app, fromForeground = false)
                    } else if (e is TrackingEffect.Stop) {
                        TrackingAlarms.cancelTick(app)
                    }
                }
            }
        }
    }

    private fun needsService(e: TrackingEffect) = when (e) {
        is TrackingEffect.ShowShift -> true
        is TrackingEffect.ApplyPlan -> e.plan != LocationPlan.NONE
        else -> false
    }

    companion object {
        private const val TAG = "MileWageTracking"

        // Holds only the application context, which lives as long as the process.
        @SuppressLint("StaticFieldLeak")
        @Volatile private var instance: TrackingRuntime? = null

        /** Null when the application does not provide [TrackingDependencies] (a wiring bug, reported as NOT_WIRED). */
        fun get(context: Context): TrackingRuntime? {
            instance?.let { return it }
            synchronized(this) {
                instance?.let { return it }
                val provider = context.applicationContext as? TrackingDependenciesProvider ?: return null
                return TrackingRuntime(context, provider.trackingDependencies).also { instance = it }
            }
        }

        /**
         * Starts (or pokes) the foreground service. Returns false when Android refuses: since
         * Android 12 a foreground service cannot be started from the background except in the
         * listed cases (a notification button, BOOT_COMPLETED, an app exempt from battery
         * optimisation...), https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
         * When [fromForeground] is false the caller is a receiver: a refusal posts a notice asking
         * the driver to open the app.
         */
        fun startService(context: Context, fromForeground: Boolean): Boolean {
            val intent = Intent(context, LocationTrackingService::class.java).setAction(LocationTrackingService.ACTION_RESUME)
            return try {
                ContextCompat.startForegroundService(context, intent)
                true
            } catch (e: Exception) {
                // ForegroundServiceStartNotAllowedException (API 31+) or IllegalStateException. No crash.
                Log.w(TAG, "Service start refused (${e::class.simpleName})")
                if (!fromForeground) postStartProblem(context)
                false
            }
        }

        /** "Open MileWage" when a shift is meant to be recording. */
        fun postStartProblem(context: Context) {
            if (PrefsTrackingStores.readActiveShift(PrefsTrackingStores.open(context)) != null) {
                TrackingNotifications.postProblem(context, TrackingNotifications.Problem.SHIFT_NOT_RECORDING)
            }
        }
    }
}
