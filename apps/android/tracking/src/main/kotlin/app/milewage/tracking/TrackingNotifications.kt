package app.milewage.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.milewage.core.tracking.ShiftNotice
import java.time.Instant

/**
 * The tracking layer's notifications: the ongoing one of the foreground service (the running
 * shift, or "Watching for drives"), the drive prompt, the "Still on shift?" nudge and the problem
 * notices that ask the driver to open the app. Standard templates only (custom layouts cannot be
 * promoted to Android 16's Live Updates).
 */
internal object TrackingNotifications {
    const val CHANNEL_SHIFT = "milewage_shift" // the Expo app's channel: its settings carry over
    const val CHANNEL_WATCH = "milewage_watch"
    const val CHANNEL_PROMPTS = "milewage_prompts"
    const val CHANNEL_PROBLEMS = "milewage_problems"
    private const val OLD_CHANNEL = "comma_tracker_channel_v2"

    const val ID_ONGOING = 9876 // the Expo tracker's id
    const val ID_PROMPT = 9877
    const val ID_NUDGE = 9878
    const val ID_PROBLEM = 9879

    /** Brand yellow, the notification's accent. */
    private const val ACCENT = 0xFFFFC21F.toInt()

    /** Android 17, where MetricStyle arrived. */
    private const val METRIC_STYLE_SDK = 37
    private const val TAG = "MileWageTracking"

    enum class Problem { SHIFT_NOT_RECORDING, DETECTION_PAUSED, START_FAILED, END_FAILED }

    fun ensureChannels(context: Context) {
        val m = context.getSystemService(NotificationManager::class.java) ?: return
        m.deleteNotificationChannel(OLD_CHANNEL)
        fun channel(id: String, name: Int, description: Int, importance: Int, silent: Boolean) =
            NotificationChannel(id, context.getString(name), importance).apply {
                this.description = context.getString(description)
                setShowBadge(false)
                if (silent) {
                    setSound(null, null)
                    enableVibration(false)
                }
            }
        m.createNotificationChannels(
            listOf(
                // Default importance so Android 16 can promote it; no sound or vibration, ever.
                channel(CHANNEL_SHIFT, R.string.tracking_channel_shift, R.string.tracking_channel_shift_description, NotificationManager.IMPORTANCE_DEFAULT, true),
                // Low, not min: a foreground service's notification at min importance makes Android
                // show its own "running in the background" notice instead (NotificationManager.IMPORTANCE_MIN).
                channel(CHANNEL_WATCH, R.string.tracking_channel_watch, R.string.tracking_channel_watch_description, NotificationManager.IMPORTANCE_LOW, true),
                // Default (a sound, no heads-up over the map while driving).
                channel(CHANNEL_PROMPTS, R.string.tracking_channel_prompts, R.string.tracking_channel_prompts_description, NotificationManager.IMPORTANCE_DEFAULT, false),
                channel(CHANNEL_PROBLEMS, R.string.tracking_channel_problems, R.string.tracking_channel_problems_description, NotificationManager.IMPORTANCE_HIGH, false),
            ),
        )
    }

    /**
     * The running shift. Android 17+: MetricStyle with the shift's distance, a live clock and
     * today's total side by side. Android 8 to 16: the distance as the title, a live clock in the
     * header. It asks to be a promoted ongoing notification (a Live Update on Android 16+), so the
     * distance also shows as a status-bar chip. Tapping opens the app; "End shift" asks the app.
     */
    fun shift(context: Context, n: ShiftNotice, t: ShiftNotice.Text): Notification {
        if (Build.VERSION.SDK_INT >= METRIC_STYLE_SDK) {
            try {
                return shiftBase(context, n, t)
                    .setContentTitle(t.metricTitle)
                    .setSubText(t.subText)
                    .setShowWhen(false)
                    .setStyle(metricStyle(t.metrics))
                    .build()
            } catch (e: RuntimeException) {
                // A style the system refuses must never stop the foreground service.
                Log.w(TAG, "MetricStyle refused; using the text layout (${e::class.simpleName})")
            }
        }
        val b = shiftBase(context, n, t)
            .setContentTitle(t.title)
            .setContentText(t.text)
            .setShowWhen(true)
            .setUsesChronometer(true)
        t.expanded?.let { b.setStyle(NotificationCompat.BigTextStyle().bigText(it)) }
        return b.build()
    }

    private fun shiftBase(context: Context, n: ShiftNotice, t: ShiftNotice.Text) =
        NotificationCompat.Builder(context, CHANNEL_SHIFT)
            .setSmallIcon(R.drawable.ic_stat_milewage)
            .setColor(ACCENT)
            .setWhen(n.startedAt)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(t.chip)
            .setContentIntent(openApp(context))
            .addAction(0, context.getString(R.string.tracking_end_shift), action(context, TrackingReceiver.ACTION_SHIFT_END))

    @RequiresApi(METRIC_STYLE_SDK)
    private fun metricStyle(metrics: List<ShiftNotice.Metric>): NotificationCompat.MetricStyle {
        val style = NotificationCompat.MetricStyle()
        for (m in metrics) {
            val value = when (m) {
                is ShiftNotice.Metric.Distance -> NotificationCompat.Metric.FixedFloat(m.value, m.unit, 1, 1)
                is ShiftNotice.Metric.Elapsed -> NotificationCompat.Metric.TimeDifference.forStopwatch(
                    Instant.ofEpochMilli(m.since),
                    NotificationCompat.Metric.TimeDifference.FORMAT_CHRONOMETER,
                )
            }
            style.addMetric(NotificationCompat.Metric(value, m.label))
        }
        return style.setCriticalMetric(0)
    }

    /** No shift: detection is watching. */
    fun watching(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_WATCH)
            .setSmallIcon(R.drawable.ic_stat_milewage)
            .setColor(ACCENT)
            .setContentTitle(context.getString(R.string.tracking_watch_title))
            .setContentText(context.getString(R.string.tracking_watch_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .setContentIntent(openApp(context))
            .build()

    /** What the service shows the instant it starts, before the state is read. */
    fun starting(context: Context, shiftRunning: Boolean): Notification =
        if (!shiftRunning) {
            watching(context)
        } else {
            NotificationCompat.Builder(context, CHANNEL_SHIFT)
                .setSmallIcon(R.drawable.ic_stat_milewage)
                .setColor(ACCENT)
                .setContentTitle(context.getString(R.string.tracking_starting_title))
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(openApp(context))
                .build()
        }

    fun postPrompt(context: Context, driveStartedAtMs: Long) {
        val n = NotificationCompat.Builder(context, CHANNEL_PROMPTS)
            .setSmallIcon(R.drawable.ic_stat_milewage)
            .setColor(ACCENT)
            .setContentTitle(context.getString(R.string.tracking_prompt_title))
            .setContentText(context.getString(R.string.tracking_prompt_text))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .addAction(
                0,
                context.getString(R.string.tracking_prompt_start),
                action(context, TrackingReceiver.ACTION_PROMPT_START) { putExtra(TrackingReceiver.EXTRA_STARTED_AT, driveStartedAtMs) },
            )
            .addAction(0, context.getString(R.string.tracking_prompt_not_now), action(context, TrackingReceiver.ACTION_PROMPT_NOT_NOW))
            // A swipe is a "Not now" too, so the prompt does not come back for this drive.
            .setDeleteIntent(action(context, TrackingReceiver.ACTION_PROMPT_NOT_NOW))
            .build()
        notify(context, ID_PROMPT, n)
    }

    fun postNudge(context: Context, stillMs: Long) {
        val minutes = Codecs.minutes(stillMs)
        val n = NotificationCompat.Builder(context, CHANNEL_PROMPTS)
            .setSmallIcon(R.drawable.ic_stat_milewage)
            .setColor(ACCENT)
            .setContentTitle(context.getString(R.string.tracking_nudge_title))
            .setContentText(context.resources.getQuantityString(R.plurals.tracking_nudge_text, minutes.toInt(), minutes))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .addAction(0, context.getString(R.string.tracking_end_shift), action(context, TrackingReceiver.ACTION_NUDGE_END))
            .addAction(0, context.getString(R.string.tracking_nudge_keep), action(context, TrackingReceiver.ACTION_NUDGE_KEEP))
            // A swipe means "Keep going": it does not nag again until the phone moves and stops again.
            .setDeleteIntent(action(context, TrackingReceiver.ACTION_NUDGE_KEEP))
            .build()
        notify(context, ID_NUDGE, n)
    }

    fun postProblem(context: Context, problem: Problem) {
        val (title, text) = when (problem) {
            Problem.SHIFT_NOT_RECORDING -> R.string.tracking_problem_shift_title to R.string.tracking_problem_shift_text
            Problem.DETECTION_PAUSED -> R.string.tracking_problem_detection_title to R.string.tracking_problem_detection_text
            Problem.START_FAILED -> R.string.tracking_problem_start_title to R.string.tracking_problem_start_text
            Problem.END_FAILED -> R.string.tracking_problem_end_title to R.string.tracking_problem_end_text
        }
        ensureChannels(context)
        val n = NotificationCompat.Builder(context, CHANNEL_PROBLEMS)
            .setSmallIcon(R.drawable.ic_stat_milewage)
            .setColor(ACCENT)
            .setContentTitle(context.getString(title))
            .setContentText(context.getString(text))
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build()
        notify(context, ID_PROBLEM, n)
    }

    fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)

    /** Posts unless notifications are off for the app: tracking carries on without them. */
    @SuppressLint("MissingPermission") // checked just before
    fun notify(context: Context, id: Int, n: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification refused (${e::class.simpleName})")
        }
    }

    /** Opens the app where it was (the launcher activity); the app shows the running shift. */
    fun openApp(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun action(context: Context, name: String, extras: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            name.hashCode(),
            Intent(context, TrackingReceiver::class.java).setAction(name).apply(extras),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
