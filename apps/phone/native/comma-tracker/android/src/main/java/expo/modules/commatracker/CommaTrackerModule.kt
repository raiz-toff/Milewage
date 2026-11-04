package expo.modules.commatracker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat

class CommaTrackerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CommaTracker")

    // cadence: optional config object from JS (CadenceConfig); missing keys take defaults.
    Function("startTracking") { cadence: Map<String, Any?>? ->
      val context = appContext.reactContext
        ?: run {
          Log.e("CommaTrackerModule", "startTracking: no reactContext")
          return@Function false
        }

      val config = try {
        CadenceConfig.fromMap(cadence)
      } catch (e: IllegalArgumentException) {
        Log.e("CommaTrackerModule", "startTracking: invalid cadence config: ${e.message}")
        return@Function false
      }

      // Refuse to launch the service without location permission. Otherwise the service
      // starts, fails at requestLocationUpdates() with a SecurityException, and runs forever
      // recording nothing while the JS layer shows an "active shift" — silent data loss.
      val granted = ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_FINE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        Log.e("CommaTrackerModule", "startTracking: ACCESS_FINE_LOCATION not granted; aborting.")
        return@Function false
      }

      Log.d("CommaTrackerModule", "startTracking called, launching foreground service")
      // Write flag and cadence BEFORE starting the service so onStartCommand sees them.
      val prefs = context.getSharedPreferences("CommaTracker", android.content.Context.MODE_PRIVATE)
      val editor = prefs.edit()
        .putBoolean("tracking_active", true)
        .putLong("tracking_started_at", System.currentTimeMillis())
        .putFloat("active_distance_meters", 0f)
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
        Log.e("CommaTrackerModule", "startTracking: failed to start foreground service", e)
        prefs.edit().putBoolean("tracking_active", false).apply()
        false
      }
    }

    Function("stopTracking") {
      val context = appContext.reactContext
      if (context != null) {
        Log.d("CommaTrackerModule", "stopTracking called, stopping service")
        // Clear flag BEFORE stopping so onDestroy does not schedule a restart
        val prefs = context.getSharedPreferences("CommaTracker", android.content.Context.MODE_PRIVATE)
        prefs.edit()
          .putBoolean("tracking_active", false)
          .putFloat("active_distance_meters", 0f)
          .apply()
        val intent = Intent(context, LocationTrackingService::class.java)
        context.stopService(intent)
      }
    }

    // Opens the system battery-optimization settings list (no exemption permission is declared,
    // 09 section 5.3). The app walks the driver through the OEM steps from there.
    Function("requestBatteryOptimizationSettings") {
      val context = appContext.reactContext ?: return@Function false
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

    // Returns the total GPS distance accumulated by the tracking service this session, in metres.
    // Dropped in M4.4: the live number comes from the engine's accumulator (09 section 5.1 item 4).
    Function("getActiveDistanceMeters") {
      val context = appContext.reactContext ?: return@Function 0.0
      val prefs = context.getSharedPreferences("CommaTracker", android.content.Context.MODE_PRIVATE)
      prefs.getFloat("active_distance_meters", 0f).toDouble()
    }
  }
}
