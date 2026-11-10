package app.milewage.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Resumes a shift that was running when the phone restarted. Placeholder, and disabled in the
 * manifest (`android:enabled="false"`) until the tracking task implements it.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // The tracking task resumes a shift that was running here.
    }
}
