package app.milewage.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.milewage.data.BackgroundResult
import app.milewage.data.MileWageDataProvider
import java.util.concurrent.TimeUnit

/** Background sending, as the facade asks for it. A no-op in tests. */
interface SendScheduler {
    /** Something was queued or a shift ended: send when a network is there, even with the app closed. */
    fun kick()

    /** The hourly check that sends what waits and reads the change log (idempotent). */
    fun ensurePeriodic()

    object None : SendScheduler {
        override fun kick() = Unit

        override fun ensurePeriodic() = Unit
    }
}

/** One unique one-time work the scheduler asks WorkManager for (a plain description, so the decision is testable). */
data class SendWork(
    val name: String,
    /** The network the work waits for. */
    val network: Network,
    /** What a second request does while one is already waiting: keep it, or start the wait again. */
    val keepExisting: Boolean,
    val backoff: Backoff,
    val backoffSeconds: Long,
) {
    enum class Network { CONNECTED, UNMETERED }

    enum class Backoff { EXPONENTIAL, LINEAR }
}

/** What gets enqueued when something waits to be sent. */
object SendPlan {
    const val ONE_TIME = "milewage-send"
    const val WIFI = "milewage-send-wifi"

    /**
     * Two one-time works. The first runs on any network and backs off exponentially when the server
     * cannot be reached (a shift that ends on mobile data with the server only on the home network
     * fails here and waits longer each time, up to an hour). The second waits for an unmetered
     * network (Wi-Fi): JobScheduler runs it the moment the phone joins one, whatever state the
     * first is in, even when the app is closed. Its backoff is short and linear: a Wi-Fi that has
     * just joined often is not ready for a second or two.
     */
    fun onWaiting(): List<SendWork> = listOf(
        SendWork(ONE_TIME, SendWork.Network.CONNECTED, keepExisting = true, SendWork.Backoff.EXPONENTIAL, 30),
        SendWork(WIFI, SendWork.Network.UNMETERED, keepExisting = true, SendWork.Backoff.LINEAR, 15),
    )
}

/**
 * Background sending on WorkManager (the platform's JobScheduler underneath; no Google services).
 *
 * - [kick]: the works of [SendPlan.onWaiting]: `milewage-send` with a connected-network constraint,
 *   KEEP (one waiting is enough: it sends everything queued when it runs), exponential backoff from
 *   30 s; and `milewage-send-wifi`, the same with an unmetered-network constraint and a short linear
 *   backoff, so joining Wi-Fi at home wakes sending even while the first one sits in a long backoff
 *   (WorkManager does not shorten a backoff when a network arrives).
 * - [ensurePeriodic]: unique periodic work `milewage-send-periodic` every hour with a network: what
 *   waits goes even if the app is never opened, and the change log is read.
 *
 * Not expedited, on purpose. Expedited work is quota-limited, and below Android 12 WorkManager runs
 * it as a foreground service, which since targetSdk 34 needs a foreground service type (dataSync,
 * with its own permission that the manifest policy does not list, and Android 15's six-hour daily
 * limit). Nothing here is urgent: every change is on the phone's disk before it is queued. While the
 * app is open, or a shift records (the tracker's foreground service keeps the process), the
 * in-process loop sends at once and every upload interval; WorkManager is the backstop.
 */
class WorkSendScheduler(private val context: Context) : SendScheduler {
    private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    override fun kick() {
        val manager = WorkManager.getInstance(context)
        for (w in SendPlan.onWaiting()) {
            val network = if (w.network == SendWork.Network.UNMETERED) NetworkType.UNMETERED else NetworkType.CONNECTED
            val work = OneTimeWorkRequestBuilder<SendWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
                .setBackoffCriteria(
                    if (w.backoff == SendWork.Backoff.LINEAR) BackoffPolicy.LINEAR else BackoffPolicy.EXPONENTIAL,
                    w.backoffSeconds,
                    TimeUnit.SECONDS,
                )
                .build()
            manager.enqueueUniqueWork(w.name, if (w.keepExisting) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE, work)
        }
    }

    override fun ensurePeriodic() {
        val work = PeriodicWorkRequestBuilder<SendWorker>(1, TimeUnit.HOURS)
            .setConstraints(connected)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, work)
    }

    companion object {
        const val ONE_TIME = SendPlan.ONE_TIME
        const val WIFI = SendPlan.WIFI
        const val PERIODIC = "milewage-send-periodic"
    }
}

/** Runs one background send through the Application's `MileWageData` (`MileWageDataProvider`). */
class SendWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val data = (applicationContext as? MileWageDataProvider)?.mileWageData ?: return Result.success()
        return when (data.runInBackground()) {
            BackgroundResult.DONE, BackgroundResult.BLOCKED -> Result.success()
            BackgroundResult.RETRY -> if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.success()
        }
    }

    private companion object {
        /** After this many retries the periodic work and the next kick take over. */
        const val MAX_ATTEMPTS = 8
    }
}
