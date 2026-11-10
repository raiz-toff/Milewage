package app.milewage.phone.platform

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import app.milewage.data.connect.AndroidNet
import app.milewage.phone.logic.PermStepId
import app.milewage.phone.logic.PermissionFacts
import app.milewage.phone.logic.Runtime
import app.milewage.tracking.TrackingPermissions

/**
 * Reads what the phone allows for the permissions ladder ([PermissionFacts]), with the one fact
 * Android does not keep: whether this app asked before (a refused permission whose prompt Android
 * will no longer show reads "not asked" otherwise). The flags live in the `app_permissions`
 * preferences, where the notifications ask already keeps its own.
 */
object ActivityPermissions {
    const val PREFS = "app_permissions"
    private const val NOTIFICATIONS_ASKED = "notifications_asked"

    /** `shouldShowRequestPermissionRationale`, from the activity behind [context]. */
    fun rationale(context: Context, permission: String): Boolean {
        val activity = context.activity() ?: return false
        return ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
    }

    private fun askedKey(step: PermStepId) = when (step) {
        PermStepId.NOTIFICATIONS -> NOTIFICATIONS_ASKED
        else -> "asked_${step.name.lowercase()}"
    }

    fun markAsked(context: Context, step: PermStepId) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(askedKey(step), true) }
    }

    /** The Android permissions a step's prompt asks for. Fine and coarse together (Android 12+ requires both). */
    fun permissionsFor(step: PermStepId): Array<String> = when (step) {
        PermStepId.LOCATION -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        PermStepId.ALL_THE_TIME -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION) else emptyArray()
        PermStepId.NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
        PermStepId.LOCAL_NETWORK -> arrayOf(AndroidNet.ACCESS_LOCAL_NETWORK)
        PermStepId.LOCATION_SWITCH, PermStepId.BATTERY -> emptyArray()
    }

    // The Android 10 and 13 permission names are plain strings, used only behind their SDK checks.
    @SuppressLint("InlinedApi")
    fun facts(context: Context, net: AndroidNet?): PermissionFacts {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun runtime(step: PermStepId, permission: String?): Runtime {
            if (permission == null) return Runtime(granted = true)
            return Runtime(
                granted = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED,
                asked = prefs.getBoolean(askedKey(step), false),
                rationale = rationale(context, permission),
            )
        }
        val t = TrackingPermissions.state(context)
        val sdk = Build.VERSION.SDK_INT
        val needsLocal = net?.localNetworkPermissionNeeded() ?: false
        return PermissionFacts(
            sdk = sdk,
            locationSwitch = t.locationEnabled,
            precise = runtime(PermStepId.LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
            approximateOnly = t.approximateOnly,
            background = runtime(PermStepId.ALL_THE_TIME, if (sdk >= Build.VERSION_CODES.Q) Manifest.permission.ACCESS_BACKGROUND_LOCATION else null),
            notificationsPermission = runtime(PermStepId.NOTIFICATIONS, if (sdk >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.POST_NOTIFICATIONS else null),
            notificationsOn = t.notifications,
            batteryExempt = t.ignoringBatteryOptimizations,
            localNetworkNeeded = needsLocal,
            localNetwork = if (needsLocal) runtime(PermStepId.LOCAL_NETWORK, AndroidNet.ACCESS_LOCAL_NETWORK) else Runtime(granted = true),
            maker = Build.MANUFACTURER ?: "",
        )
    }

    /**
     * The system's own label for the background location option ("Allow all the time", in the
     * phone's language), Android 11 and later; null before (the screen uses its own words).
     */
    fun allTheTimeLabel(context: Context): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) context.packageManager.backgroundPermissionOptionLabel.toString().takeIf { it.isNotBlank() } else null

    private tailrec fun Context.activity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.activity()
        else -> null
    }
}
