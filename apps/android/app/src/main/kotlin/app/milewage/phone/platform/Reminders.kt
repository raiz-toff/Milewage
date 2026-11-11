package app.milewage.phone.platform

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.milewage.core.sync.Reminder
import app.milewage.core.sync.ReminderPort
import app.milewage.phone.MainActivity
import app.milewage.phone.R
import java.util.concurrent.TimeUnit

/**
 * The app's own notification channel and permission. The tracking module owns its channels (shift
 * in progress, prompts, problems); this is the one for reminders. Created at
 * start-up (cheap, idempotent), so it is listed in the phone's settings from the first run.
 */
object AppNotifications {
    const val REMINDER_CHANNEL = "milewage_reminders"
    const val UNSYNCED_ID = 4001

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(REMINDER_CHANNEL, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.channel_reminders_description)
        nm.createNotificationChannel(channel)
    }

    /** Whether a reminder would reach the driver now: the permission (Android 13+), the app's switch and the channel's. Reads, never asks. */
    fun canPost(context: Context): Boolean {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        val channel = nm.getNotificationChannelCompat(REMINDER_CHANNEL)
        return channel == null || channel.importance != NotificationManagerCompat.IMPORTANCE_NONE
    }

    /** Opens the app on Home. */
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

/**
 * [ReminderPort] on the platform (15 section 4.4, decision 1.5d): the "shifts only on this phone"
 * reminder on its own channel, one id so a new one replaces the old; a later one is scheduled as
 * unique WorkManager work with a delay (inexact, no exact-alarm permission, survives a reboot).
 * Without the permission nothing is shown or scheduled; cancelling always works.
 */
class ReminderNotifications(context: Context) : ReminderPort {
    private val app = context.applicationContext

    override suspend fun show(reminder: Reminder) = post(app, reminder.level, reminder.unsentShifts, reminder.days)

    override suspend fun schedule(atMs: Long, reminder: Reminder) {
        if (!granted()) return
        val delay = maxOf(0L, atMs - System.currentTimeMillis())
        val work = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(K_LEVEL to reminder.level.name, K_SHIFTS to reminder.unsentShifts, K_DAYS to reminder.days))
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, work)
    }

    override suspend fun cancel() {
        WorkManager.getInstance(app).cancelUniqueWork(WORK)
        NotificationManagerCompat.from(app).cancel(AppNotifications.UNSYNCED_ID)
    }

    override suspend fun granted(): Boolean = AppNotifications.canPost(app)

    companion object {
        const val WORK = "milewage-reminder"
        const val K_LEVEL = "level"
        const val K_SHIFTS = "shifts"
        const val K_DAYS = "days"

        /** The words, from strings.xml (the Expo app's, decision 1.5d). */
        fun text(context: Context, level: Reminder.Level, shifts: Int, days: Long): String = if (level == Reminder.Level.STRONG) {
            context.resources.getQuantityString(R.plurals.reminder_strong, shifts, shifts, days)
        } else {
            context.resources.getQuantityString(R.plurals.reminder_normal, shifts, shifts)
        }

        fun post(context: Context, level: Reminder.Level, shifts: Int, days: Long) {
            if (level == Reminder.Level.NONE || shifts <= 0 || !AppNotifications.canPost(context)) return
            val body = text(context, level, shifts, days)
            val n = NotificationCompat.Builder(context, AppNotifications.REMINDER_CHANNEL)
                .setSmallIcon(app.milewage.tracking.R.drawable.ic_stat_milewage)
                .setContentTitle(context.getString(R.string.reminder_title))
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(AppNotifications.openApp(context))
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(AppNotifications.UNSYNCED_ID, n)
            } catch (_: SecurityException) {
                // The permission was taken away between the check and the post: the banner still says it.
            }
        }
    }
}

/** Shows the scheduled reminder when its time comes, with the words it was scheduled with. */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val level = runCatching { Reminder.Level.valueOf(inputData.getString(ReminderNotifications.K_LEVEL) ?: "") }.getOrNull() ?: return Result.success()
        ReminderNotifications.post(
            applicationContext,
            level,
            inputData.getInt(ReminderNotifications.K_SHIFTS, 0),
            inputData.getLong(ReminderNotifications.K_DAYS, 0),
        )
        return Result.success()
    }
}
