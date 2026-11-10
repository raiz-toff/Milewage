package app.milewage.tracking

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Wake-ups without the exact-alarm permission (SCHEDULE_EXACT_ALARM is Play-restricted and not in
 * the manifest policy): `setAndAllowWhileIdle` on the elapsed-realtime clock, which fires through
 * Doze but may come late. Used for the stillness and detector deadlines (a nudge a few minutes
 * late is fine) and for the restart safety net after the task is removed, as the Expo tracker did.
 */
internal object TrackingAlarms {
    private const val RESTART_DELAY_MS = 2_000L

    fun scheduleTick(context: Context, delayMs: Long) = set(context, TrackingReceiver.ACTION_TICK, delayMs)

    fun cancelTick(context: Context) {
        context.getSystemService(AlarmManager::class.java)?.cancel(pending(context, TrackingReceiver.ACTION_TICK))
    }

    /** The safety net when the task is swiped away or the service is destroyed mid-shift. */
    fun scheduleRestart(context: Context) = set(context, TrackingReceiver.ACTION_RESTART, RESTART_DELAY_MS)

    private fun set(context: Context, action: String, delayMs: Long) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs, pending(context, action))
    }

    private fun pending(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        action.hashCode(),
        Intent(context, TrackingReceiver::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
