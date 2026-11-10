package app.milewage.data.connect

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.ext.SdkExtensions
import androidx.annotation.RequiresApi
import app.milewage.core.connect.Announcement
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.Executor
import kotlin.coroutines.resume

/**
 * Browses for a DNS-SD service type (`_milewage._tcp`) with Android's NsdManager (the platform's
 * mDNS, no Google services) for `browseMs`, then resolves what it found one at a time and returns
 * the list once. A port of the Expo app's `native/net-check` Discovery, on the current API:
 * - resolving uses `registerServiceInfoCallback` on Android 14+ (API 34), where `resolveService` is
 *   deprecated, and `resolveService` before; one at a time, since before Android 14 NsdManager
 *   resolves only one service at a time; a resolve that never answers is given up after 3 s;
 * - addresses come from `getHostAddresses` on API 34+ (`getHost` is deprecated there);
 * - receiving mDNS on Wi-Fi needs multicast: before T extensions 7 the app must hold a
 *   [WifiManager.MulticastLock] itself, even in the foreground (NsdManager reference, "Wi-Fi
 *   Multicast Lock"); from T extensions 7 the system manages it for foreground apps. The lock is
 *   held only while browsing and resolving (CHANGE_WIFI_MULTICAST_STATE, a normal permission).
 *
 * No other permission at targetSdk 36. From targetSdk 37 (Android 17) local network access needs
 * the runtime permission ACCESS_LOCAL_NETWORK (NEARBY_DEVICES group) for this and for plain http to
 * the home address: see [AndroidNet.localNetworkPermissionNeeded] and data/README.md.
 */
class NsdDiscovery(context: Context) {
    private val app = context.applicationContext
    private val nsd: NsdManager? = app.getSystemService(NsdManager::class.java)

    suspend fun browse(type: String, browseMs: Long): List<Announcement> {
        val nsd = nsd ?: return emptyList()
        return withMulticastLock {
            val found = LinkedHashMap<String, NsdServiceInfo>()
            val failed = CompletableDeferred<Unit>()
            val listener = object : NsdManager.DiscoveryListener {
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    failed.complete(Unit)
                }

                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
                override fun onDiscoveryStarted(serviceType: String) = Unit
                override fun onDiscoveryStopped(serviceType: String) = Unit

                override fun onServiceFound(info: NsdServiceInfo) {
                    synchronized(found) { found[info.serviceName] = info }
                }

                override fun onServiceLost(info: NsdServiceInfo) {
                    synchronized(found) { found.remove(info.serviceName) }
                }
            }
            try {
                nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
            } catch (_: RuntimeException) {
                return@withMulticastLock emptyList()
            }
            try {
                withTimeoutOrNull(browseMs) { failed.await() } // ends early only when discovery failed to start
            } finally {
                try {
                    nsd.stopServiceDiscovery(listener)
                } catch (_: RuntimeException) {
                    // already stopped
                }
            }
            val services = synchronized(found) { found.values.toList() }
            services.mapNotNull { info -> withTimeoutOrNull(RESOLVE_MS) { resolve(nsd, info) }?.let(::entry) }
        }
    }

    private suspend fun resolve(nsd: NsdManager, info: NsdServiceInfo): NsdServiceInfo? =
        if (Build.VERSION.SDK_INT >= 34) resolve34(nsd, info) else resolveLegacy(nsd, info)

    @RequiresApi(34)
    private suspend fun resolve34(nsd: NsdManager, info: NsdServiceInfo): NsdServiceInfo? {
        val result = CompletableDeferred<NsdServiceInfo?>()
        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                result.complete(null)
            }

            override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.hostAddresses.isNotEmpty() && serviceInfo.port > 0) result.complete(serviceInfo)
            }

            override fun onServiceLost() {
                result.complete(null)
            }

            override fun onServiceInfoCallbackUnregistered() = Unit
        }
        try {
            nsd.registerServiceInfoCallback(info, DIRECT, callback)
        } catch (_: RuntimeException) {
            return null
        }
        return try {
            result.await()
        } finally {
            try {
                nsd.unregisterServiceInfoCallback(callback)
            } catch (_: RuntimeException) {
                // already gone
            }
        }
    }

    @Suppress("DEPRECATION") // resolveService is the only way before API 34
    private suspend fun resolveLegacy(nsd: NsdManager, info: NsdServiceInfo): NsdServiceInfo? =
        suspendCancellableCoroutine { cont ->
            try {
                nsd.resolveService(
                    info,
                    object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                            if (cont.isActive) cont.resume(null)
                        }

                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            if (cont.isActive) cont.resume(serviceInfo)
                        }
                    },
                )
            } catch (_: RuntimeException) {
                if (cont.isActive) cont.resume(null)
            }
        }

    private fun entry(r: NsdServiceInfo): Announcement? {
        val addresses = if (Build.VERSION.SDK_INT >= 34) r.hostAddresses else @Suppress("DEPRECATION") listOfNotNull(r.host)
        return ServiceEntry.of(r.serviceName, addresses, r.port, r.attributes)
    }

    private suspend fun <T> withMulticastLock(block: suspend () -> T): T {
        if (!needsMulticastLock()) return block()
        val wifi = app.getSystemService(WifiManager::class.java) ?: return block()
        val lock = try {
            wifi.createMulticastLock("milewage-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (_: RuntimeException) {
            null // discovery may still work; do not fail because of the lock
        }
        try {
            return block()
        } finally {
            try {
                lock?.release()
            } catch (_: RuntimeException) {
                // released already
            }
        }
    }

    private companion object {
        const val RESOLVE_MS = 3_000L
        val DIRECT = Executor { it.run() }

        /** Before T extensions 7 the app must take the multicast lock itself (NsdManager reference). */
        fun needsMulticastLock(): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.R || tExtension() < 7

        @RequiresApi(Build.VERSION_CODES.R)
        fun tExtension(): Int = SdkExtensions.getExtensionVersion(Build.VERSION_CODES.TIRAMISU)
    }
}
