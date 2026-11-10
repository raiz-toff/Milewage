package app.milewage.data.connect

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import app.milewage.core.connect.Discovery
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.NetPort
import app.milewage.core.connect.NetState
import app.milewage.core.connect.NetTransport

/**
 * [NetPort] on Android: the active network from ConnectivityManager (reads only, no prompt), MileWage
 * servers on the Wi-Fi from [NsdDiscovery], and Tailscale through the package manager (only
 * `com.tailscale.ipn` is visible, named under `<queries>` in this module's manifest). A port of the
 * Expo app's `native/net-check` module.
 */
class AndroidNet(context: Context) : NetPort {
    private val app = context.applicationContext
    private val discovery = NsdDiscovery(app)

    /** The active network's transports; null with no network or when Android cannot say. */
    fun transports(): Set<NetTransport>? = try {
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val caps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        Transports.of(caps?.let { c -> { t: Int -> c.hasTransport(t) } })
    } catch (_: SecurityException) {
        null
    }

    override suspend fun vpnActive(): Boolean? = NetState.vpnActive(transports())

    override suspend fun localNetwork(): Boolean? = NetState.localNetwork(transports())

    override suspend fun discover(): List<FoundServer> =
        Discovery.serversFrom(discovery.browse(Discovery.SERVICE_TYPE, Discovery.BROWSE_MS))

    override suspend fun tailscaleInstalled(): Boolean =
        app.packageManager.getLaunchIntentForPackage(NetState.TAILSCALE) != null

    override suspend fun openTailscale() {
        val launch = app.packageManager.getLaunchIntentForPackage(NetState.TAILSCALE)
        val intents = listOfNotNull(
            launch,
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${NetState.TAILSCALE}")),
            Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${NetState.TAILSCALE}")),
        )
        for (intent in intents) {
            try {
                app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: ActivityNotFoundException) {
                // no store app: try the next
            }
        }
    }

    /**
     * True when local network access must be asked for before discovery or plain http to the home
     * address: only from Android 17 for an app that targets 37 (ACCESS_LOCAL_NETWORK, a runtime
     * permission in the NEARBY_DEVICES group). At targetSdk 36 it is part of INTERNET, and the
     * platform docs say not to declare it, so this is false until the targetSdk bump.
     */
    fun localNetworkPermissionNeeded(): Boolean =
        Build.VERSION.SDK_INT >= 37 &&
            app.applicationInfo.targetSdkVersion >= 37 &&
            app.checkSelfPermission(ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED

    companion object {
        const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
    }
}
