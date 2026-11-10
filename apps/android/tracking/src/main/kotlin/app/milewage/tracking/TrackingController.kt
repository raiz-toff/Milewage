package app.milewage.tracking

import android.annotation.SuppressLint
import android.content.Context
import app.milewage.core.tracking.ActiveShift
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.ShiftNotice
import app.milewage.core.tracking.TrackingProblem
import app.milewage.core.tracking.TrackingSettings
import app.milewage.core.tracking.TrackingStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the app calls. Start and stop recording, drive detection on or off, the notification's
 * details, and the live [status]. The app's shift logic (the shift row, the server, the engine
 * run at the end) stays in the app; this only records.
 *
 * Call the start methods while the app is on screen: Android lets a location foreground service
 * start from the foreground (and from a notification button, which the tracker handles itself).
 */
class TrackingController private constructor(private val context: Context) {
    private val runtime: TrackingRuntime? = TrackingRuntime.get(context)

    /** The tracker's state. Never holds a coordinate. */
    val status: StateFlow<TrackingStatus> =
        runtime?.core?.status ?: MutableStateFlow(TrackingStatus(problem = TrackingProblem.NOT_WIRED)).asStateFlow()

    enum class StartResult { STARTED, NO_LOCATION_PERMISSION, NOT_ALLOWED, NOT_WIRED }

    enum class DetectionResult { ON, OFF, NEEDS_BACKGROUND_LOCATION, NOT_ALLOWED, NOT_WIRED }

    /**
     * Starts recording [shiftClientId], which started at [startedAt] (phone clock, epoch ms). For
     * a shift started from the drive prompt, [startedAt] is the drive's start, and the fixes the
     * detector kept since then are stored first. Calling it again for the running shift is a no-op.
     */
    suspend fun startShift(shiftClientId: String, startedAt: Long): StartResult {
        val rt = runtime ?: return StartResult.NOT_WIRED
        if (!TrackingPermissions.hasPreciseLocation(context)) return StartResult.NO_LOCATION_PERMISSION
        val shift = ActiveShift(shiftClientId, startedAt)
        val before = rt.deps.activeShiftStore.get()
        // Written before the service starts, so a service (re)started at any point finds it.
        rt.deps.activeShiftStore.set(shift)
        if (rt.service == null && !TrackingRuntime.startService(context, fromForeground = true)) {
            rt.deps.activeShiftStore.set(before)
            rt.core.reportProblem(TrackingProblem.START_NOT_ALLOWED)
            return StartResult.NOT_ALLOWED
        }
        rt.call { startShift(shift, System.currentTimeMillis()) }
        return StartResult.STARTED
    }

    /** Stops recording. The shift's fixes stay in the fix store; nothing else is touched. */
    suspend fun stopShift() {
        val rt = runtime ?: return
        rt.call { stopShift(System.currentTimeMillis()) }
    }

    /**
     * Settings > drive detection. Turning it on needs precise location "all the time" (it runs
     * with no app on screen); the answer says what is missing.
     */
    suspend fun setDetection(on: Boolean): DetectionResult {
        val rt = runtime ?: return DetectionResult.NOT_WIRED
        if (!on) {
            rt.call { setDetection(false, System.currentTimeMillis()) }
            return DetectionResult.OFF
        }
        if (!TrackingPermissions.state(context).canDetect) return DetectionResult.NEEDS_BACKGROUND_LOCATION
        val settings = rt.deps.settingsStore.get()
        rt.deps.settingsStore.set(settings.copy(detectionEnabled = true))
        if (rt.service == null && !TrackingRuntime.startService(context, fromForeground = true)) {
            rt.deps.settingsStore.set(settings)
            return DetectionResult.NOT_ALLOWED
        }
        rt.call { setDetection(true, System.currentTimeMillis()) }
        return DetectionResult.ON
    }

    /** The cadence and the nudge time (detection has its own call). Applied at once. */
    suspend fun updateSettings(settings: TrackingSettings) {
        val rt = runtime ?: return
        val current = rt.deps.settingsStore.get()
        rt.deps.settingsStore.set(settings.copy(detectionEnabled = current.detectionEnabled))
        rt.call { reloadSettings(System.currentTimeMillis()) }
    }

    suspend fun settings(): TrackingSettings = runtime?.deps?.settingsStore?.get() ?: TrackingSettings()

    /** What the running-shift notification says around the distance (from `shiftNotice` in `:core`). */
    suspend fun setNotice(notice: ShiftNotice) {
        val rt = runtime ?: return
        rt.call { setNotice(notice) }
    }

    /** `fix_time - phone time` of the last GNSS fix, or null when none in the last 10 minutes (15 section 10). */
    fun gnssOffsetMs(): Long? = status.value.freshGnssOffsetMs(System.currentTimeMillis())

    /** Times the tracker knows nothing was recorded, for the engine's `interruptions`. */
    suspend fun interruptions(shiftClientId: String): List<Interruption> =
        runtime?.deps?.interruptionLog?.list(shiftClientId) ?: emptyList()

    fun permissions(): TrackingPermissionState = TrackingPermissions.state(context)

    /**
     * Call when the app comes to the foreground: restarts a shift or detection that should be
     * running but is not (killed, refused a background start). False when it still cannot run.
     */
    suspend fun ensureRunning(): Boolean {
        val rt = runtime ?: return false
        return Resumer.resume(context, rt, fromForeground = true)
    }

    companion object {
        // Holds only the application context, which lives as long as the process.
        @SuppressLint("StaticFieldLeak")
        @Volatile private var instance: TrackingController? = null

        fun get(context: Context): TrackingController =
            instance ?: synchronized(this) { instance ?: TrackingController(context.applicationContext).also { instance = it } }
    }
}
