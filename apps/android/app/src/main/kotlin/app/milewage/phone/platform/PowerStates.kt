package app.milewage.phone.platform

import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.PowerManager

/** The app's standby bucket (Android 9+; no permission needed for the app's own); null before or when unreadable. */
fun standbyBucket(context: Context): Int? =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        null
    } else {
        runCatching { context.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket }.getOrNull()
    }

/** Battery Saver is on. */
fun powerSave(context: Context): Boolean = runCatching { context.getSystemService(PowerManager::class.java)?.isPowerSaveMode == true }.getOrDefault(false)
