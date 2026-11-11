package app.milewage.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch

/**
 * After a restart of the phone (or an update of the app, which also stops its service): resumes a
 * shift that was recording. Nothing else.
 *
 * This reverses the 2026-11-03 "no boot receiver" decision (owner decision 2026-11-10, native app).
 * `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` are among the cases where Android lets an app start a
 * foreground service from the background, and Android 15's boot restriction does not cover the
 * `location` type:
 * https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions
 * https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed
 * Without "Allow all the time" the start is refused (while-in-use restriction), so a notice asks
 * the driver to open the app instead.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val runtime = TrackingRuntime.get(context) ?: return
        val pending = goAsync()
        runtime.scope.launch {
            try {
                runtime.deps.diagnostics.record("boot", mapOf("action" to (intent.action ?: "")))
                Resumer.resume(context, runtime, fromForeground = false)
            } finally {
                pending.finish()
            }
        }
    }
}
