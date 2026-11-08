package expo.modules.netcheck

import android.net.NetworkCapabilities.TRANSPORT_CELLULAR
import android.net.NetworkCapabilities.TRANSPORT_ETHERNET
import android.net.NetworkCapabilities.TRANSPORT_VPN
import android.net.NetworkCapabilities.TRANSPORT_WIFI
import org.junit.Assert.assertEquals
import org.junit.Test

class LocalNetworkTest {
  @Test
  fun wifiAndEthernetAreLocal() {
    assertEquals(true, LocalNetwork.of { it == TRANSPORT_WIFI })
    assertEquals(true, LocalNetwork.of { it == TRANSPORT_ETHERNET })
  }

  @Test
  fun tailscaleOverWifiIsStillLocal() {
    val tailscaleOnWifi = setOf(TRANSPORT_WIFI, TRANSPORT_VPN)
    assertEquals(true, LocalNetwork.of { it in tailscaleOnWifi })
  }

  @Test
  fun mobileDataIsNot() {
    val tailscaleOnCellular = setOf(TRANSPORT_CELLULAR, TRANSPORT_VPN)
    assertEquals(false, LocalNetwork.of { it in tailscaleOnCellular })
  }

  @Test
  fun noNetworkCannotTell() {
    assertEquals(null, LocalNetwork.of(null))
  }
}
