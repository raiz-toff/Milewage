package app.milewage.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.milewage.core.tracking.CommandOutcome
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * The notification buttons and the alarms. Private (not exported): only this app's
 * PendingIntents reach it.
 *
 * Start and End shift are the app's to do ([app.milewage.core.tracking.ShiftCommands]): this
 * receiver asks, and when the app answers OPEN_APP (or fails) it posts "Open MileWage", because
 * Android 12+ does not let a receiver open an activity from a notification button (notification
 * trampolines). A button tap lets the app start its foreground service from the background
 * ("the user performs an action on a ... notification"):
 * https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions
 */
class TrackingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val runtime = TrackingRuntime.get(context) ?: return
        val now = System.currentTimeMillis()
        when (intent.action) {
            ACTION_TICK -> if (runtime.service != null) runtime.submit { onTick(now) } else resume(context, runtime)
            ACTION_RESTART -> if (runtime.service == null) resume(context, runtime)
            ACTION_PROMPT_NOT_NOW -> runtime.submit { notNow(now) }
            ACTION_NUDGE_KEEP -> runtime.submit { keepGoing(now) }
            ACTION_PROMPT_START -> {
                TrackingNotifications.cancel(context, TrackingNotifications.ID_PROMPT)
                val startedAt = intent.getLongExtra(EXTRA_STARTED_AT, now)
                ask(runtime, TrackingNotifications.Problem.START_FAILED) { runtime.deps.shiftCommands.startDetectedShift(startedAt) }
            }
            ACTION_SHIFT_END, ACTION_NUDGE_END -> {
                TrackingNotifications.cancel(context, TrackingNotifications.ID_NUDGE)
                ask(runtime, TrackingNotifications.Problem.END_FAILED) { runtime.deps.shiftCommands.endShift() }
            }
        }
    }

    /** Asks the app; posts "Open MileWage" when it cannot do it alone. The work outlives the broadcast. */
    private fun ask(runtime: TrackingRuntime, problem: TrackingNotifications.Problem, command: suspend () -> CommandOutcome) {
        val pending = goAsync()
        runtime.scope.launch {
            val outcome = try {
                withTimeout(COMMAND_TIMEOUT_MS) { command() }
            } catch (_: TimeoutCancellationException) {
                CommandOutcome.OPEN_APP
            } catch (e: Exception) {
                runtime.deps.diagnostics.record("command_error", mapOf("type" to (e::class.simpleName ?: "Exception")))
                CommandOutcome.OPEN_APP
            } finally {
                pending.finish()
            }
            if (outcome == CommandOutcome.OPEN_APP) TrackingNotifications.postProblem(runtime.app, problem)
        }
    }

    private fun resume(context: Context, runtime: TrackingRuntime) {
        val pending = goAsync()
        runtime.scope.launch {
            try {
                Resumer.resume(context, runtime, fromForeground = false)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_TICK = "app.milewage.tracking.TICK"
        const val ACTION_RESTART = "app.milewage.tracking.RESTART"
        const val ACTION_PROMPT_START = "app.milewage.tracking.PROMPT_START"
        const val ACTION_PROMPT_NOT_NOW = "app.milewage.tracking.PROMPT_NOT_NOW"
        const val ACTION_NUDGE_END = "app.milewage.tracking.NUDGE_END"
        const val ACTION_NUDGE_KEEP = "app.milewage.tracking.NUDGE_KEEP"
        const val ACTION_SHIFT_END = "app.milewage.tracking.SHIFT_END"
        const val EXTRA_STARTED_AT = "startedAt"

        /** A broadcast has about 10 s; the app's command must answer within this. */
        private const val COMMAND_TIMEOUT_MS = 8_000L
    }
}

/**
 * Restarts what should be running (a shift, or detection) when the service is not: after a
 * reboot, an app update, a kill, or from the app on launch.
 */
internal object Resumer {
    suspend fun resume(context: Context, runtime: TrackingRuntime, fromForeground: Boolean): Boolean {
        if (runtime.service != null) return true
        val shift = runtime.deps.activeShiftStore.get()
        val detection = runtime.deps.settingsStore.get().detectionEnabled
        if (shift == null && !detection) return true
        // From the background, Android 14+ refuses a location foreground service unless the app
        // holds "Allow all the time" (the while-in-use restriction); below 14 it would start but
        // receive no location. Either way the driver must open the app.
        val allowed = TrackingPermissions.hasPreciseLocation(context) &&
            (fromForeground || TrackingPermissions.hasBackgroundLocation(context))
        if (!allowed) {
            if (!fromForeground) TrackingRuntime.postStartProblem(context)
            runtime.deps.diagnostics.record("resume_refused", mapOf("reason" to "permission", "shift" to (shift != null).toString()))
            return false
        }
        return TrackingRuntime.startService(context, fromForeground)
    }
}
