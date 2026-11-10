package app.milewage.tracking

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

/** What the phone allows tracking to do right now. No UI: the app's permission ladder reads it. */
data class TrackingPermissionState(
    /** ACCESS_FINE_LOCATION: precise location. Without it nothing is recorded (GNSS needs it). */
    val preciseLocation: Boolean,
    /** ACCESS_COARSE_LOCATION only (Android 12+ "Approximate"): not enough to record. */
    val approximateOnly: Boolean,
    /** "Allow all the time" (Android 10+; implied below). Needed for drive detection and for starts after a reboot. */
    val backgroundLocation: Boolean,
    /** POST_NOTIFICATIONS (Android 13+; implied below) and the app's notifications switched on. */
    val notifications: Boolean,
    /** The phone's Location switch. */
    val locationEnabled: Boolean,
    /** Battery optimisation is off for the app: Android then also allows restarts from the background. */
    val ignoringBatteryOptimizations: Boolean,
) {
    val canRecord: Boolean get() = preciseLocation && locationEnabled
    val canDetect: Boolean get() = canRecord && backgroundLocation
}

object TrackingPermissions {
    fun state(context: Context): TrackingPermissionState {
        val fine = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val notifications = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(context, Manifest.permission.POST_NOTIFICATIONS))
        val lm = context.getSystemService(LocationManager::class.java)
        val pm = context.getSystemService(PowerManager::class.java)
        return TrackingPermissionState(
            preciseLocation = fine,
            approximateOnly = coarse && !fine,
            backgroundLocation = (fine || coarse) && background,
            notifications = notifications,
            locationEnabled = lm != null && LocationManagerCompat.isLocationEnabled(lm),
            ignoringBatteryOptimizations = pm?.isIgnoringBatteryOptimizations(context.packageName) == true,
        )
    }

    internal fun hasPreciseLocation(context: Context) = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

    internal fun hasBackgroundLocation(context: Context) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    /** This app's page in system settings, where a refused permission is changed. */
    fun appSettingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * The system list of battery optimisation exemptions. The app declares no
     * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission (manifest policy), so it opens the list and
     * the driver chooses, as the Expo app did.
     */
    fun batteryOptimizationSettingsIntent(): Intent =
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** The phone's Location switch. */
    fun locationSettingsIntent(): Intent =
        Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
