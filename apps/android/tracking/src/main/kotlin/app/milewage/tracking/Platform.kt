package app.milewage.tracking

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import androidx.core.location.LocationManagerCompat
import app.milewage.core.tracking.DeviceCapabilities
import app.milewage.core.tracking.RawLocation

/** `android.location.Location` to the platform-neutral sample. Never logged. */
internal fun Location.toRaw(): RawLocation = RawLocation(
    provider = provider ?: "unknown",
    timeMs = time,
    // Set by the framework on every fix since API 17: when the fix was made, on the monotonic clock.
    elapsedRealtimeMs = elapsedRealtimeNanos.takeIf { it > 0 }?.let { it / 1_000_000 },
    lat = latitude,
    lon = longitude,
    accuracyM = if (hasAccuracy()) accuracy else null,
    speedMps = if (hasSpeed()) speed else null,
    bearingDeg = if (hasBearing()) bearing else null,
    altitudeM = if (hasAltitude()) altitude else null,
)

/** What this phone has. The network provider is often missing on phones without Google services. */
internal fun readCapabilities(context: Context): DeviceCapabilities {
    val lm = context.getSystemService(LocationManager::class.java)
    val sm = context.getSystemService(SensorManager::class.java)
    return DeviceCapabilities(
        hasGps = lm != null && LocationManagerCompat.hasProvider(lm, LocationManager.GPS_PROVIDER),
        hasNetwork = lm != null && LocationManagerCompat.hasProvider(lm, LocationManager.NETWORK_PROVIDER),
        // Sensor.TYPE_SIGNIFICANT_MOTION needs no permission (unlike the step sensors, which need
        // ACTIVITY_RECOGNITION): https://developer.android.com/reference/android/hardware/Sensor#TYPE_SIGNIFICANT_MOTION
        hasSignificantMotion = sm?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) != null,
    )
}
