package expo.modules.commatracker

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import java.lang.ref.WeakReference
import org.json.JSONObject

class LocationTrackingService : Service() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var isLocationUpdateActive = false
    private var activityPendingIntent: PendingIntent? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var cadence = CadenceConfig()
    /** The running distance shown in the notification; rebuilt from the buffer after a restart. */
    private var live: LiveDistance? = null
    /** What the notification shows now, so it is only re-posted when the text changes. */
    private var shownTitle: String? = null
    private val pauseGpsRunnable = Runnable {
        Log.d(TAG, "Still for ${cadence.stillTimeoutMs}ms — pausing GPS to save battery.")
        stopLocationUpdates()
    }

    companion object {
        // A silent channel of its own; the old Comma-named one is deleted on first use.
        private const val CHANNEL_ID = "milewage_shift"
        private const val OLD_CHANNEL_ID = "comma_tracker_channel_v2"
        private const val NOTIFICATION_ID = 9876
        private const val TAG = "LocationTrackingService"
        private const val PREFS_NAME = "CommaTracker"
        private const val KEY_TRACKING_ACTIVE = "tracking_active"
        const val CADENCE_PREFS_PREFIX = "cadence_"
        const val KEY_SHIFT_CLIENT_ID = "shift_client_id"
        const val KEY_GNSS_OFFSET = "gnss_offset_ms"
        const val KEY_GNSS_OFFSET_AT = "gnss_offset_at"
        private const val RESTART_DELAY_MS = 2000L
        // Commands delivered by ActivityTransitionReceiver when movement state changes.
        const val ACTION_MOVEMENT = "expo.modules.commatracker.ACTION_MOVEMENT"
        const val ACTION_STILL = "expo.modules.commatracker.ACTION_STILL"
        /** The shift details from JS (`setNotice`), as JSON, kept so a restarted service shows them. */
        const val KEY_NOTICE = "notice"
        /** Brand yellow (apps/phone/src/theme/colors.ts), the notification's accent. */
        private const val ACCENT = 0xFFFFC21F.toInt()

        @Volatile private var running: WeakReference<LocationTrackingService>? = null

        /** Called after `setNotice` stored new shift details: the running service re-posts its notification. */
        fun noticeChanged() {
            val service = running?.get() ?: return
            service.mainHandler.post { service.refreshNotice(force = true) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        running = WeakReference(this)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                for (location in locationResult.locations) {
                    processLocation(location)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // On Android 13+ the system can restart this service with a null intent
        // (START_STICKY). Check the flag — if the shift was ended normally, stop
        // immediately rather than restarting phantom tracking.
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_TRACKING_ACTIVE, false)) {
            Log.d(TAG, "onStartCommand: tracking_active=false, stopping self.")
            stopSelf()
            return START_NOT_STICKY
        }

        // Cadence comes from JS at start (persisted so a restarted service uses the same values).
        cadence = try {
            CadenceConfig.fromMap(
                CadenceConfig().toMap().keys.associateWith { prefs.all[CADENCE_PREFS_PREFIX + it] }
            )
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Stored cadence invalid; using defaults.", e)
            CadenceConfig()
        }

        if (live == null) live = seedLive(prefs)
        createNotificationChannel()
        val notification = buildNotification()
        try {
            // Android 10+ requires the foreground-service type to be supplied at the
            // startForeground() call site; on Android 14 the 2-arg overload throws
            // MissingForegroundServiceTypeException (the manifest declaration alone is not
            // enough). Android 12+ additionally throws ForegroundServiceStartNotAllowedException
            // when this is reached from a background-delivered start (AlarmManager restart or
            // BootReceiver) — in that case we cannot legally run, so abandon instead of crashing.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground refused (likely a background start on Android 12+); abandoning.", e)
            stopSelf()
            return START_NOT_STICKY
        }

        // Movement-gated GPS (battery-first): the foreground service stays up for the whole
        // shift, but the GPS radio only runs while the user is actually moving. Movement/still
        // is detected by the Activity Transition API (cheap, runs on the sensor hub).
        when (intent?.action) {
            ACTION_MOVEMENT -> {
                cancelPauseGps()
                if (!isLocationUpdateActive) startLocationUpdates()
            }
            ACTION_STILL -> {
                schedulePauseGps()
            }
            else -> {
                // Initial start (or START_STICKY re-create): begin GPS now so we never miss an
                // in-progress drive, and register movement detection so we can sleep GPS while still.
                if (!isLocationUpdateActive) startLocationUpdates()
                registerActivityTransitions()
            }
        }

        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // User swiped the app from recents. stopWithTask="false" keeps the service
        // alive on stock Android, but schedule a restart as a safety net for OEMs.
        Log.d(TAG, "App task removed — scheduling safety-net restart.")
        scheduleRestart()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (running?.get() === this) running = null
        cancelPauseGps()
        unregisterActivityTransitions()
        fusedLocationClient.removeLocationUpdates(locationCallback)
        isLocationUpdateActive = false
        Log.d(TAG, "LocationTrackingService destroyed.")

        // If the shift is still supposed to be active (notification dismissed by user
        // or killed by the OS on Android 13+), reschedule the service to restart.
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_TRACKING_ACTIVE, false)) {
            Log.d(TAG, "Shift still active — scheduling restart after destroy.")
            scheduleRestart()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ─── Private helpers ────────────────────────────────────────────────────────

    private fun scheduleRestart() {
        val restartIntent = Intent(applicationContext, LocationTrackingService::class.java)
        val pendingIntent = PendingIntent.getService(
            applicationContext,
            1,
            restartIntent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAt = SystemClock.elapsedRealtime() + RESTART_DELAY_MS
        // A ~2s restart does not need exact-alarm precision. We use the inexact
        // allow-while-idle variant, which still fires through Doze but needs no special
        // permission — SCHEDULE_EXACT_ALARM is Play-restricted and has been removed from
        // the manifest. (setAndAllowWhileIdle exists on API 23+.)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent
            )
        } else {
            alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        }
    }

    private fun startLocationUpdates() {
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, cadence.intervalMs).apply {
            setMinUpdateDistanceMeters(cadence.minDisplacementM)
            setMaxUpdateDelayMillis(cadence.maxUpdateDelayMs)
        }.build()

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                android.os.Looper.getMainLooper()
            )
            isLocationUpdateActive = true

            // Capture last known location immediately as the shift start anchor,
            // avoiding the 10s cold-start gap before the first real GPS fix.
            fusedLocationClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    val ageMs = System.currentTimeMillis() - loc.time
                    if (ageMs < 60_000L) {
                        // Do not log raw coordinates — precise location is PII and Log.d is not
                        // stripped from release builds (readable via adb logcat).
                        Log.d(TAG, "Anchor point saved (age=${ageMs}ms)")
                        saveToBuffer(loc)
                    } else {
                        Log.d(TAG, "Last known location too stale (${ageMs}ms), skipping anchor.")
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Lost location permission: $e")
        }
    }

    private fun stopLocationUpdates() {
        if (!isLocationUpdateActive) return
        fusedLocationClient.removeLocationUpdates(locationCallback)
        isLocationUpdateActive = false
        Log.d(TAG, "GPS paused (user still).")
    }

    private fun schedulePauseGps() {
        mainHandler.removeCallbacks(pauseGpsRunnable)
        mainHandler.postDelayed(pauseGpsRunnable, cadence.stillTimeoutMs)
    }

    private fun cancelPauseGps() {
        mainHandler.removeCallbacks(pauseGpsRunnable)
    }

    // ─── Movement detection (Activity Transition API) ───────────────────────────
    private fun registerActivityTransitions() {
        if (activityPendingIntent != null) return // already registered

        val activityTypes = intArrayOf(
            DetectedActivity.IN_VEHICLE,
            DetectedActivity.ON_BICYCLE,
            DetectedActivity.WALKING,
            DetectedActivity.RUNNING,
            DetectedActivity.STILL
        )
        val transitions = ArrayList<ActivityTransition>()
        for (type in activityTypes) {
            transitions.add(
                ActivityTransition.Builder()
                    .setActivityType(type)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build()
            )
        }
        val request = ActivityTransitionRequest(transitions)

        val broadcast = Intent(this, ActivityTransitionReceiver::class.java)
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getBroadcast(this, 2, broadcast, piFlags)
        activityPendingIntent = pi

        try {
            ActivityRecognition.getClient(this)
                .requestActivityTransitionUpdates(request, pi)
                .addOnSuccessListener { Log.d(TAG, "Activity transitions registered (movement-gated GPS active).") }
                .addOnFailureListener { e -> Log.e(TAG, "Activity transition registration failed; GPS stays on. $e") }
        } catch (e: SecurityException) {
            // ACTIVITY_RECOGNITION not granted → degrade gracefully: GPS just stays on for the
            // whole shift (the prior behavior). No crash, no battery gating.
            Log.e(TAG, "ACTIVITY_RECOGNITION not granted; movement gating disabled.", e)
            activityPendingIntent = null
        }
    }

    private fun unregisterActivityTransitions() {
        val pi = activityPendingIntent ?: return
        try {
            ActivityRecognition.getClient(this).removeActivityTransitionUpdates(pi)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister activity transitions", e)
        }
        activityPendingIntent = null
    }

    /** Every fix the provider delivers is stored, unfiltered (09 section 5.1 item 4). */
    private fun processLocation(loc: android.location.Location) = saveToBuffer(loc)

    private fun saveToBuffer(loc: android.location.Location) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val shiftId = prefs.getString(KEY_SHIFT_CLIENT_ID, null) ?: return
        try {
            val point = PointMapper.toPoint(
                shiftId,
                loc.time,
                loc.latitude,
                loc.longitude,
                if (loc.hasAccuracy()) loc.accuracy else null,
                if (loc.hasSpeed()) loc.speed else null,
                if (loc.hasBearing()) loc.bearing else null,
                if (loc.hasAltitude()) loc.altitude else null,
            )
            val seq = AndroidSqlDb.buffer(this).insert(point)
            live?.push(point.copy(seq = seq))
            refreshNotice()
            // Latest GNSS offset for event times (15 section 10).
            prefs.edit()
                .putLong(KEY_GNSS_OFFSET, PointMapper.gnssOffsetMs(loc.time, System.currentTimeMillis()))
                .putLong(KEY_GNSS_OFFSET_AT, System.currentTimeMillis())
                .apply()
        } catch (e: Exception) {
            // Never log coordinates (PII; survives into release logcat).
            Log.e(TAG, "Failed to save fix to the buffer", e)
        }
    }

    // ─── The running-shift notification ─────────────────────────────────────────

    private fun notice(prefs: android.content.SharedPreferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)): ShiftNotice {
        val fallbackStart = prefs.getLong("tracking_started_at", System.currentTimeMillis())
        val json = prefs.getString(KEY_NOTICE, null) ?: return ShiftNotice(startedAt = fallbackStart)
        return try {
            val o = JSONObject(json)
            ShiftNotice.fromMap(o.keys().asSequence().associateWith { o.opt(it) }, fallbackStart)
        } catch (e: Exception) {
            ShiftNotice(startedAt = fallbackStart)
        }
    }

    /** The shift's distance so far from every stored row of it, as the app does after a restart. */
    private fun seedLive(prefs: android.content.SharedPreferences): LiveDistance {
        val acc = LiveDistance(notice(prefs).startedAt)
        val shiftId = prefs.getString(KEY_SHIFT_CLIENT_ID, null) ?: return acc
        try {
            val buffer = AndroidSqlDb.buffer(this)
            var after = 0L
            while (true) {
                val page = buffer.readByShift(shiftId, after, 5_000)
                page.forEach(acc::push)
                if (page.size < 5_000) break
                after = page.last().seq
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not read the buffer for the running distance", e)
        }
        return acc
    }

    /** Re-posts the notification when what it says has changed (at most once per new fix). */
    private fun refreshNotice(force: Boolean = false) {
        val n = notice()
        val title = n.text(live?.runningTotalM() ?: 0).title
        if (!force && title == shownTitle) return
        try {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(n))
        } catch (e: SecurityException) {
            // Notifications switched off for the app: tracking carries on without it.
            Log.e(TAG, "Could not update the shift notification", e)
        }
    }

    /**
     * Collapsed: the shift's distance, today's total and a live clock in the header. Expanded:
     * today's total, start time and vehicle. On Android 16 it asks to be a promoted ongoing
     * notification, so the distance also shows as a chip in the status bar. Tapping opens the app.
     */
    private fun buildNotification(n: ShiftNotice = notice()): Notification {
        val t = n.text(live?.runningTotalM() ?: 0)
        shownTitle = t.title
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.milewage_notification)
            .setColor(ACCENT)
            .setContentTitle(t.title)
            .setContentText(t.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(t.expanded))
            .setWhen(n.startedAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(t.chip)

        // Tapping the ongoing notification reopens the app — without a content intent it does
        // nothing, which is the main way a user returns to a tracking app.
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) {
            launchIntent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
            val contentIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            builder.setContentIntent(contentIntent)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.deleteNotificationChannel(OLD_CHANNEL_ID)
            // Default importance so Android 16 can promote it; no sound or vibration, ever.
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Shift in progress",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Distance and time of the running shift."
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }
    }
}
