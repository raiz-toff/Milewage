package expo.modules.commatracker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat

/** JS-facing tracker interface (09 section 5.1 item 5). Points are identified by their `seq`. */
class CommaTrackerModule : Module() {
  private val context: Context? get() = appContext.reactContext
  private fun prefs(c: Context) = c.getSharedPreferences("CommaTracker", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("CommaTracker")

    // cadence: optional config object from JS (CadenceConfig); missing keys take defaults.
    Function("start") { shiftClientId: String, cadence: Map<String, Any?>? ->
      val context = context
        ?: run {
          Log.e("CommaTrackerModule", "start: no reactContext")
          return@Function false
        }
      if (shiftClientId.isBlank()) return@Function false

      val config = try {
        CadenceConfig.fromMap(cadence)
      } catch (e: IllegalArgumentException) {
        Log.e("CommaTrackerModule", "start: invalid cadence config: ${e.message}")
        return@Function false
      }

      // Refuse to launch the service without location permission. Otherwise the service
      // starts, fails at requestLocationUpdates() with a SecurityException, and runs forever
      // recording nothing while the JS layer shows an "active shift" — silent data loss.
      val granted = ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_FINE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        Log.e("CommaTrackerModule", "start: ACCESS_FINE_LOCATION not granted; aborting.")
        return@Function false
      }

      // Write flag, shift id and cadence BEFORE starting the service so onStartCommand sees them.
      val prefs = prefs(context)
      val editor = prefs.edit()
        .putBoolean("tracking_active", true)
        .putLong("tracking_started_at", System.currentTimeMillis())
        .putString(LocationTrackingService.KEY_SHIFT_CLIENT_ID, shiftClientId)
      for ((key, value) in config.toMap()) {
        val prefKey = LocationTrackingService.CADENCE_PREFS_PREFIX + key
        if (value is Float) editor.putFloat(prefKey, value) else editor.putLong(prefKey, value.toLong())
      }
      editor.apply()
      val intent = Intent(context, LocationTrackingService::class.java)
      return@Function try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (API 31+) when started from background.
        Log.e("CommaTrackerModule", "start: failed to start foreground service", e)
        prefs.edit().putBoolean("tracking_active", false).apply()
        false
      }
    }

    Function("stop") {
      val context = context
      if (context != null) {
        // Clear the flag BEFORE stopping so onDestroy does not schedule a restart.
        prefs(context).edit()
          .putBoolean("tracking_active", false)
          .remove(LocationTrackingService.KEY_SHIFT_CLIENT_ID)
          .apply()
        context.stopService(Intent(context, LocationTrackingService::class.java))
      }
    }

    Function("isTracking") {
      val context = context ?: return@Function false
      prefs(context).getBoolean("tracking_active", false)
    }

    // Oldest PENDING points first, as plain maps in the wire units of 08 section 5.
    Function("readPending") { limit: Int ->
      val context = context ?: return@Function emptyList<Map<String, Any?>>()
      AndroidSqlDb.buffer(context).readPending(limit).map {
        mapOf(
          "seq" to it.seq, "shiftClientId" to it.shiftClientId, "recordedAt" to it.recordedAt,
          "latE7" to it.latE7, "lonE7" to it.lonE7, "accuracyM" to it.accuracyM,
          "speedDmps" to it.speedDmps, "bearingDeg" to it.bearingDeg, "altitudeM" to it.altitudeM,
        )
      }
    }

    Function("markUploaded") { seqs: List<Double> ->
      val context = context ?: return@Function 0
      AndroidSqlDb.buffer(context).markUploaded(seqs.map { it.toLong() }, System.currentTimeMillis())
    }

    Function("markRejected") { seqs: List<Double> ->
      val context = context ?: return@Function 0
      AndroidSqlDb.buffer(context).markRejected(seqs.map { it.toLong() }, "server_rejected", System.currentTimeMillis())
    }

    Function("evictUploaded") { olderThanMs: Double ->
      val context = context ?: return@Function 0
      AndroidSqlDb.buffer(context).evictUploaded(olderThanMs.toLong())
    }

    // Latest `fix_time − now`; null when no fix arrived in the last 10 minutes (15 section 10).
    Function("gnssOffsetMs") {
      val context = context ?: return@Function null
      val prefs = prefs(context)
      val at = prefs.getLong(LocationTrackingService.KEY_GNSS_OFFSET_AT, 0L)
      if (at == 0L || System.currentTimeMillis() - at > 600_000L) null
      else prefs.getLong(LocationTrackingService.KEY_GNSS_OFFSET, 0L).toDouble()
    }

    // Opens the system battery-optimization settings list (no exemption permission is declared,
    // 09 section 5.3). The app walks the driver through the OEM steps from there.
    Function("requestBatteryOptimizationSettings") {
      val context = context ?: return@Function false
      val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
        true
      } catch (e: Exception) {
        Log.e("CommaTrackerModule", "Failed to open battery settings", e)
        false
      }
    }
  }
}
