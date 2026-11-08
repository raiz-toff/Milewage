package expo.modules.netcheck

import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Browses for a DNS-SD service type (`_milewage._tcp`) with Android's NsdManager for `browseMs`,
 * then resolves what it found one at a time (before Android 14 NsdManager resolves only one at a
 * time) and hands the list over once. NsdManager runs in the system, so no multicast lock is needed.
 * With target SDK 36 no permission is needed beyond INTERNET (plan 28 section 3.3).
 */
class Discovery(
  private val nsd: NsdManager,
  private val type: String,
  private val browseMs: Long,
  private val done: (List<Map<String, Any?>>) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val found = LinkedHashMap<String, NsdServiceInfo>()
  private val results = mutableListOf<Map<String, Any?>>()
  private var finished = false

  private val browse = object : NsdManager.DiscoveryListener {
    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
      main.post { finish() }
    }
    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    override fun onDiscoveryStarted(serviceType: String) {}
    override fun onDiscoveryStopped(serviceType: String) {}
    override fun onServiceFound(info: NsdServiceInfo) {
      synchronized(found) { found[info.serviceName] = info }
    }
    override fun onServiceLost(info: NsdServiceInfo) {
      synchronized(found) { found.remove(info.serviceName) }
    }
  }

  fun start() {
    try {
      nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, browse)
    } catch (e: Exception) {
      finish()
      return
    }
    main.postDelayed({ stopAndResolve() }, browseMs)
  }

  private fun stopAndResolve() {
    if (finished) return
    try {
      nsd.stopServiceDiscovery(browse)
    } catch (e: Exception) {
      // already stopped
    }
    resolveNext(ArrayDeque(synchronized(found) { found.values.toList() }))
  }

  private fun resolveNext(queue: ArrayDeque<NsdServiceInfo>) {
    val info = queue.removeFirstOrNull() ?: return finish()
    var answered = false
    val next = Runnable {
      if (!answered) {
        answered = true
        resolveNext(queue)
      }
    }
    main.postDelayed(next, 3000) // a resolve that never answers does not hold up the rest
    try {
      @Suppress("DEPRECATION") // resolveService still works; registerServiceInfoCallback is API 34+
      nsd.resolveService(info, object : NsdManager.ResolveListener {
        override fun onResolveFailed(i: NsdServiceInfo, errorCode: Int) {
          main.post { main.removeCallbacks(next); next.run() }
        }
        override fun onServiceResolved(r: NsdServiceInfo) {
          main.post {
            entry(r)?.let { results.add(it) }
            main.removeCallbacks(next)
            next.run()
          }
        }
      })
    } catch (e: Exception) {
      main.removeCallbacks(next)
      next.run()
    }
  }

  private fun entry(r: NsdServiceInfo): Map<String, Any?>? {
    val addresses =
      if (Build.VERSION.SDK_INT >= 34) r.hostAddresses
      else @Suppress("DEPRECATION") listOfNotNull(r.host)
    return ServiceEntry.of(r.serviceName, addresses, r.port, r.attributes)
  }

  private fun finish() {
    if (finished) return
    finished = true
    done(results.toList())
  }
}
