package expo.modules.netcheck

import android.net.NetworkCapabilities.TRANSPORT_VPN
import android.net.NetworkCapabilities.TRANSPORT_WIFI
import org.junit.Assert.assertEquals
import org.junit.Test

class VpnStateTest {
  @Test
  fun aVpnOverWifiIsAVpn() {
    val tailscaleOnWifi = setOf(TRANSPORT_WIFI, TRANSPORT_VPN)
    assertEquals(true, VpnState.of { it in tailscaleOnWifi })
  }

  @Test
  fun wifiAloneIsNot() {
    assertEquals(false, VpnState.of { it == TRANSPORT_WIFI })
  }

  @Test
  fun noNetworkCannotTell() {
    assertEquals(null, VpnState.of(null))
  }
}
