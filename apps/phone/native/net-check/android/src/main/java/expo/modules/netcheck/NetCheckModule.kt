package expo.modules.netcheck

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the Connect screen needs to say which step is wrong (plan 19 §3.5), and the network kind (plan 28). Reads only. */
class NetCheckModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("NetCheck")

    // Whether the active network is a VPN; null with no network or when it cannot be read.
    Function("vpnActive") {
      try {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        VpnState.of(caps?.let { c -> { t: Int -> c.hasTransport(t) } })
      } catch (e: Exception) {
        null
      }
    }

    // Whether the active network is Wi-Fi or Ethernet (plan 28): only then is the home address tried.
    Function("localNetwork") {
      try {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        LocalNetwork.of(caps?.let { c -> { t: Int -> c.hasTransport(t) } })
      } catch (e: Exception) {
        null
      }
    }

    // Only packages listed under <queries> in this module's manifest are visible.
    Function("isInstalled") { pkg: String ->
      context.packageManager.getLaunchIntentForPackage(pkg) != null
    }

    Function("openApp") { pkg: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return@Function false
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }
  }
}
