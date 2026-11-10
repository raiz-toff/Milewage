package app.milewage.phone.ui.components

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.edit
import app.milewage.phone.platform.AppNotifications
import app.milewage.phone.platform.SystemScreens

/**
 * The notifications permission (Android 13+), the app's to ask: the running shift's time and
 * distance, the drive prompt and the reminders all need it. [NotificationAsk.request] asks the first
 * time; once Android stops showing the question (asked before, or refused), it opens the app's
 * notification settings instead. [NotificationAsk.askOnce] asks only if it never asked (used on the
 * first Start shift) and never opens settings.
 */
class NotificationAsk(private val context: Context, private val launch: () -> Unit) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val needed: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !AppNotifications.canPost(context)

    fun request() {
        if (AppNotifications.canPost(context)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !prefs.getBoolean(ASKED, false)) {
            prefs.edit { putBoolean(ASKED, true) }
            launch()
        } else {
            SystemScreens.notificationSettings(context)
        }
    }

    fun askOnce() {
        if (!needed || prefs.getBoolean(ASKED, false)) return
        prefs.edit { putBoolean(ASKED, true) }
        launch()
    }

    private companion object {
        const val PREFS = "app_permissions"
        const val ASKED = "notifications_asked"
    }
}

@Composable
fun rememberNotificationAsk(onResult: (Boolean) -> Unit = {}): NotificationAsk {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(), onResult)
    return remember(context, launcher) {
        NotificationAsk(context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
