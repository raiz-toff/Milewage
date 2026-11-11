package app.milewage.tracking

import android.annotation.SuppressLint
import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import app.milewage.core.tracking.InterruptionReason
import app.milewage.core.tracking.LocationPlan
import app.milewage.core.tracking.ProviderRequest
import app.milewage.core.tracking.RawLocation
import app.milewage.core.tracking.RequestQuality
import app.milewage.core.tracking.TrackingEffect
import app.milewage.core.tracking.TrackingMode
import app.milewage.core.tracking.TrackingProblem

/**
 * The foreground service (type `location`) that records a shift. Thin on purpose: every decision is in `TrackingCore` (`:core`), tested on the
 * JVM; this class holds the platform `LocationManager` requests, the significant-motion trigger,
 * the ongoing notification and the restart safety net, and passes fixes in.
 *
 * Platform rules relied on:
 * - `startForeground` with type `location` within seconds of every start, and the type passed at
 *   the call: Android 14 throws `MissingForegroundServiceTypeException` otherwise, and checks the
 *   location permission at that moment ("while-in-use" restriction): started from the
 *   background without "Allow all the time" it throws `SecurityException`, and is then stopped
 *   with a notice to open the app, never a crash.
 *   https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions
 * - `BOOT_COMPLETED` may start a `location` foreground service (Android 15 only forbids
 *   dataSync, camera, mediaPlayback, phoneCall, mediaProjection and microphone):
 *   https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed
 * - `START_STICKY` and `stopWithTask="false"` keep a shift alive when the task is swiped away; a
 *   restart alarm (no exact-alarm permission) is the safety net for phones that kill it anyway.
 */
class LocationTrackingService : Service(), ServiceSink {
    private var runtime: TrackingRuntime? = null
    private lateinit var locationManager: LocationManager
    private var sensorManager: SensorManager? = null
    private val main = Handler(Looper.getMainLooper())
    private val listeners = HashMap<String, LocationListenerCompat>()
    private var plan: LocationPlan = LocationPlan.NONE
    private var motionArmed = false
    private var started = false
    private var stopping = false
    private var ongoing: Notification? = null

    private val tick = object : Runnable {
        override fun run() {
            runtime?.submit { onTick(System.currentTimeMillis()) }
            main.postDelayed(this, TICK_MS)
        }
    }

    private val motion = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            motionArmed = false // one-shot: the plan re-arms it if it still wants it
            runtime?.submit { onSignificantMotion(System.currentTimeMillis()) }
            main.post { armMotion(plan.significantMotion) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(LocationManager::class.java)
        sensorManager = getSystemService(SensorManager::class.java)
        TrackingNotifications.ensureChannels(this)
        val rt = TrackingRuntime.get(this)
        runtime = rt
        rt?.service = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val rt = runtime
        // Every start (also a sticky restart with a null intent) must go foreground at once.
        if (!goForeground(ongoing ?: TrackingNotifications.starting(this))) {
            rt?.core?.reportProblem(TrackingProblem.START_NOT_ALLOWED)
            TrackingRuntime.postStartProblem(this)
            stopping = true
            stopSelf()
            return START_NOT_STICKY
        }
        if (rt == null) {
            Log.e(TAG, "The application provides no TrackingDependencies; stopping.")
            stopping = true
            stopSelf()
            return START_NOT_STICKY
        }
        if (!started) {
            started = true
            main.postDelayed(tick, TICK_MS)
            rt.submit { start(System.currentTimeMillis()) }
        }
        return START_STICKY
    }

    private fun goForeground(notification: Notification): Boolean = try {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, TrackingNotifications.ID_ONGOING, notification, type)
        true
    } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (Android 12+, a start from the background) or
        // SecurityException (Android 14+, no location permission usable from the background).
        Log.w(TAG, "startForeground refused (${e::class.simpleName})")
        false
    }

    // ------------------------------------------------------------- effects

    override fun apply(effect: TrackingEffect) {
        when (effect) {
            is TrackingEffect.ApplyPlan -> applyPlan(effect.plan)
            is TrackingEffect.ShowShift -> show(TrackingNotifications.shift(this, effect.notice, effect.text))
            is TrackingEffect.WakeAt -> {
                val at = effect.atMs
                if (at == null) {
                    TrackingAlarms.cancelTick(this)
                } else {
                    TrackingAlarms.scheduleTick(this, Codecs.wakeDelayMs(at, System.currentTimeMillis()))
                }
            }
            TrackingEffect.Stop -> stopTracking()
            else -> Unit // notification effects are applied by the runtime
        }
    }

    private fun show(n: Notification) {
        ongoing = n
        TrackingNotifications.notify(this, TrackingNotifications.ID_ONGOING, n)
    }

    @SuppressLint("MissingPermission") // checked: hasPreciseLocation, and SecurityException is caught
    private fun applyPlan(next: LocationPlan) {
        removeAllUpdates()
        plan = next
        armMotion(next.significantMotion)
        if (next.requests.isEmpty()) return
        if (!TrackingPermissions.hasPreciseLocation(this)) {
            lost(InterruptionReason.PERMISSION_LOST)
            return
        }
        for (r in next.requests) {
            if (r.provider != LocationManager.PASSIVE_PROVIDER && !LocationManagerCompat.hasProvider(locationManager, r.provider)) continue
            val listener = listenerFor(r.provider)
            try {
                LocationManagerCompat.requestLocationUpdates(locationManager, r.provider, request(r), ContextCompat.getMainExecutor(this), listener)
                listeners[r.provider] = listener
            } catch (_: SecurityException) {
                lost(InterruptionReason.PERMISSION_LOST)
                return
            } catch (_: IllegalArgumentException) {
                // The provider vanished between the check and the request: the next plan retries.
            }
        }
        if (next.recordingProvider != null && listeners.isNotEmpty()) {
            val enabled = LocationManagerCompat.isLocationEnabled(locationManager)
            runtime?.submit { locationAvailability(enabled, InterruptionReason.LOCATION_OFF, System.currentTimeMillis()) }
        }
    }

    private fun request(r: ProviderRequest): LocationRequestCompat =
        LocationRequestCompat.Builder(r.intervalMs)
            .setMinUpdateIntervalMillis(r.intervalMs)
            .setMinUpdateDistanceMeters(r.minDistanceM)
            .setMaxUpdateDelayMillis(r.maxUpdateDelayMs)
            .setQuality(
                when (r.quality) {
                    RequestQuality.HIGH_ACCURACY -> LocationRequestCompat.QUALITY_HIGH_ACCURACY
                    RequestQuality.BALANCED_POWER_ACCURACY -> LocationRequestCompat.QUALITY_BALANCED_POWER_ACCURACY
                    RequestQuality.LOW_POWER -> LocationRequestCompat.QUALITY_LOW_POWER
                },
            )
            .build()

    /**
     * One listener per provider: the platform replaces a listener's registration when the same
     * listener is registered for another provider.
     */
    private fun listenerFor(provider: String): LocationListenerCompat = object : LocationListenerCompat {
        override fun onLocationChanged(location: Location) = deliver(listOf(location))

        override fun onLocationChanged(locations: MutableList<Location>) = deliver(locations)

        override fun onProviderDisabled(p: String) {
            if (p == plan.recordingProvider) {
                runtime?.submit { locationAvailability(false, InterruptionReason.LOCATION_OFF, System.currentTimeMillis()) }
            }
        }

        override fun onProviderEnabled(p: String) {
            if (p == plan.recordingProvider) {
                runtime?.submit { locationAvailability(true, InterruptionReason.LOCATION_OFF, System.currentTimeMillis()) }
            }
        }

        override fun toString() = "MileWage listener ($provider)"
    }

    private fun deliver(locations: List<Location>) {
        if (locations.isEmpty()) return
        // Never log a coordinate (precise location is personal data and logcat survives into
        // release builds): only the fix objects travel, to the core and the fix store.
        val raws: List<RawLocation> = locations.map { it.toRaw() }
        val wall = System.currentTimeMillis()
        val elapsed = SystemClock.elapsedRealtime()
        runtime?.submit { onLocations(raws, wall, elapsed) }
    }

    private fun lost(reason: InterruptionReason) {
        runtime?.submit { locationAvailability(false, reason, System.currentTimeMillis()) }
    }

    private fun armMotion(want: Boolean) {
        val sm = sensorManager ?: return
        val sensor = sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) ?: return
        if (want && !motionArmed) {
            motionArmed = sm.requestTriggerSensor(motion, sensor)
        } else if (!want && motionArmed) {
            sm.cancelTriggerSensor(motion, sensor)
            motionArmed = false
        }
    }

    @SuppressLint("MissingPermission") // removing needs no permission; a SecurityException is caught anyway
    private fun removeAllUpdates() {
        for (l in listeners.values) {
            try {
                LocationManagerCompat.removeUpdates(locationManager, l)
            } catch (_: RuntimeException) {
                // Already gone, or the permission was taken away (the registration went with it).
            }
        }
        listeners.clear()
    }

    private fun stopTracking() {
        stopping = true
        removeAllUpdates()
        armMotion(false)
        TrackingAlarms.cancelTick(this)
        main.removeCallbacks(tick)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ------------------------------------------------------------ lifecycle

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Swiped from recents. stopWithTask="false" keeps the service on stock Android; the alarm
        // is the safety net for phones that kill it anyway.
        if (!stopping && runtime?.core?.currentMode != TrackingMode.STOPPED) TrackingAlarms.scheduleRestart(this)
    }

    override fun onDestroy() {
        main.removeCallbacks(tick)
        removeAllUpdates()
        armMotion(false)
        val rt = runtime
        if (rt?.service === this) rt.service = null
        // Destroyed without being asked to stop (the system killed it, Android 13+ task manager,
        // the notification dismissed): a shift still meant to record is restarted.
        if (!stopping && rt != null && rt.core.currentMode != TrackingMode.STOPPED) TrackingAlarms.scheduleRestart(this)
        super.onDestroy()
    }

    companion object {
        const val ACTION_RESUME = "app.milewage.tracking.RESUME"
        private const val TAG = "MileWageTracking"

        /** While the processor is awake anyway; deadlines in deep sleep come from the alarm. */
        private const val TICK_MS = 15_000L
    }
}
