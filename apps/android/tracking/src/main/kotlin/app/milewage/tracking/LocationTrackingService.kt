package app.milewage.tracking

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * The foreground service that records a shift's location (type `location`). Placeholder: it does
 * nothing and stops itself if started. The tracking task gives it the notification, the location
 * requests (platform LocationManager, no Google Play Services) and the hand-off to :engine.
 */
class LocationTrackingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopSelf(startId)
        return START_NOT_STICKY
    }
}
