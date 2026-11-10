package app.milewage.phone.platform

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import app.milewage.tracking.TrackingPermissions

/** The phone's own settings pages a message can lead to. A page a phone lacks falls back to the app's page. */
object SystemScreens {
    fun appSettings(context: Context) = open(context, TrackingPermissions.appSettingsIntent(context))

    fun locationSettings(context: Context) = open(context, TrackingPermissions.locationSettingsIntent())

    fun batterySettings(context: Context) = open(context, TrackingPermissions.batteryOptimizationSettingsIntent())

    fun storageSettings(context: Context) = open(context, Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    /** The app's notification settings, where a refused notifications permission is turned back on. */
    fun notificationSettings(context: Context) = open(
        context,
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )

    private fun open(context: Context, intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            context.startActivity(TrackingPermissions.appSettingsIntent(context))
        }
    }
}
